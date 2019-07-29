import { action } from 'mobx';
import { Wallet as FantasyGoldWallet, Insight, WalletRPCProvider } from 'fantasygoldjs-wallet';
import deepEqual from 'deep-equal';

import { ISigner } from '../types';
import { ISendTxOptions } from 'fantasygoldjs-wallet/lib/tx';
import { RPC_METHOD, NETWORK_NAMES } from '../constants';

export default class Wallet implements ISigner {
  public fjsWallet?: FantasyGoldWallet;
  public rpcProvider?: WalletRPCProvider;
  public info?: Insight.IGetInfo;
  public fantasygoldUSD?: number;
  public maxFantasyGoldSend?: number;

  constructor(fjsWallet: FantasyGoldWallet) {
    this.fjsWallet = fjsWallet;
    this.rpcProvider = new WalletRPCProvider(this.fjsWallet);
  }

  @action
  public updateInfo = async () => {
    if (!this.fjsWallet) {
      console.error('Cannot updateInfo without fjsWallet instance.');
    }

    /**
     * We add a timeout promise to handle if fjsWallet hangs when executing getInfo.
     * (This happens if the insight api is down)
     */
    let timedOut = false;
    const timeoutPromise = new Promise((_, reject) => {
      const wait = setTimeout(() => {
        clearTimeout(wait);
        timedOut = true;
        reject(Error('wallet.getInfo failed, insight api may be down'));
      }, 30000);
    });

    const getInfoPromise = this.fjsWallet!.getInfo();
    const promises = [timeoutPromise, getInfoPromise];
    let newInfo: any;
    try {
      newInfo = await Promise.race(promises);

      // if they are not equal, then the balance has changed
      if (!timedOut && !deepEqual(this.info, newInfo)) {
        this.info = newInfo;
        return true;
      }
    } catch (e) {
      throw(Error(e));
    }

    return false;
  }

  // @param amount: (unit - whole FGC)
  public send = async (to: string, amount: number, options: ISendTxOptions): Promise<Insight.ISendRawTxResult> => {
    if (!this.fjsWallet) {
      throw Error('Cannot send without wallet.');
    }

    // convert amount units from whole FGC=> SATOSHI FGC
    return await this.fjsWallet!.send(to, amount * 1e8, { feeRate: options.feeRate });
  }

  public sendTransaction = async (args: any[]): Promise<any> => {
    if (!this.rpcProvider) {
      throw Error('Cannot sign transaction without RPC provider.');
    }
    if (args.length < 2) {
      throw Error('Requires first two arguments: contractAddress and data.');
    }

    try {
      return await this.rpcProvider!.rawCall(RPC_METHOD.SEND_TO_CONTRACT, args);
    } catch (err) {
      throw err;
    }
  }

  public calcMaxFantasyGoldSend = async (networkName: string) => {
    if (!this.fjsWallet || !this.info) {
      throw Error('Cannot calculate max send amount without wallet or this.info.');
    }
    this.maxFantasyGoldSend = await this.fjsWallet.sendEstimateMaxValue(this.maxFantasyGoldSendToAddress(networkName));
    return this.maxFantasyGoldSend;
  }

  /**
   * We just need to pass a valid sendTo address belonging to that network for the
   * fantasygoldjs-wallet library to calculate the maxFantasyGoldSend amount.  It does not matter what
   * the specific address is, as that does not affect the value of the
   * maxFantasyGoldSend amount
   */
  private maxFantasyGoldSendToAddress = (networkName: string) => {
    return networkName === NETWORK_NAMES.MAINNET ?
      'FQNnmnaeSnRmMuSpbkop1Nei2cPQMe7WAq' : 'fLJsx41F8Uv1KFF3RbrZfdLnyWQzvPdeF9'; //TODO Testnet
  }
}

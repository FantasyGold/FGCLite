import { each, findIndex, isEmpty } from 'lodash';
import BigNumber from 'bignumber.js';
import { Insight } from 'fantasygoldjs-wallet';
const { FGCweb3 } = require('fgcweb3');

import FGCLiteController from '.';
import IController from './iController';
import { MESSAGE_TYPE, STORAGE, NETWORK_NAMES } from '../../constants';
import FGCToken from '../../models/FGCToken';
import fgc20TokenABI from '../../contracts/fgc20TokenABI';
import mainnetTokenList from '../../contracts/mainnetTokenList';
import testnetTokenList from '../../contracts/testnetTokenList';
import regtestTokenList from '../../contracts/regtestTokenList';
import { generateRequestId } from '../../utils';
import { IRPCCallResponse } from '../../types';

const INIT_VALUES = {
  tokens: undefined,
  getBalancesInterval: undefined,
};
const fgcweb3 = new FGCweb3('null');

export default class TokenController extends IController {
  private static GET_BALANCES_INTERVAL_MS: number = 60000;

  public tokens?: FGCToken[] = INIT_VALUES.tokens;

  private getBalancesInterval?: number = INIT_VALUES.getBalancesInterval;

  constructor(main: FGCLiteController) {
    super('token', main);

    chrome.runtime.onMessage.addListener(this.handleMessage);
    this.initFinished();
  }

  public resetTokenList = () => {
    this.tokens = INIT_VALUES.tokens;
  }

  /*
  * Init the token list based on the environment.
  */
  public initTokenList = () => {
    if (this.tokens) {
      return;
    }

    chrome.storage.local.get([this.chromeStorageAccountTokenListKey()], (res: any) => {
      if (!isEmpty(res)) {
        this.tokens = res[this.chromeStorageAccountTokenListKey()];
      } else if (this.main.network.networkName === NETWORK_NAMES.MAINNET) {
        this.tokens = mainnetTokenList;
      } else if (this.main.network.networkName === NETWORK_NAMES.TESTNET) {
        this.tokens = testnetTokenList;
      } else {
        this.tokens = regtestTokenList;
      }
    });
  }

  /*
  * Starts polling for periodic info updates.
  */
  public startPolling = async () => {
    await this.getBalances();
    if (!this.getBalancesInterval) {
      this.getBalancesInterval = window.setInterval(() => {
        this.getBalances();
      }, TokenController.GET_BALANCES_INTERVAL_MS);
    }
  }

  /*
  * Stops polling for the periodic info updates.
  */
  public stopPolling = () => {
    if (this.getBalancesInterval) {
      clearInterval(this.getBalancesInterval);
      this.getBalancesInterval = undefined;
    }
  }

  /*
  * Fetch the tokens balances via RPC calls.
  */
  private getBalances = () => {
    each(this.tokens, async (token: FGCToken) => {
      await this.getFGCTokenBalance(token);
    });
  }

  /*
  * Makes an RPC call to the contract to get the token balance of this current wallet address.
  * @param token The FGCToken to get the balance of.
  */
  private getFGCTokenBalance = async (token: FGCToken) => {
    if (!this.main.account.loggedInAccount
      || !this.main.account.loggedInAccount.wallet
      || !this.main.account.loggedInAccount.wallet.fjsWallet
    ) {
      console.error('Cannot getFGCTokenBalance without wallet instance.');
      return;
    }

    const methodName = 'balanceOf';
    const data = fgcweb3.encoder.constructData(
      fgc20TokenABI,
      methodName,
      [this.main.account.loggedInAccount.wallet.fjsWallet.address],
    );
    const args = [token.address, data];
    const { result, error } = await this.main.rpc.callContract(generateRequestId(), args);

    if (error) {
      console.error(error);
      return;
    }

    // Decode result
    const decodedRes = fgcweb3.decoder.decodeCall(result, fgc20TokenABI, methodName);
    const bnBal = decodedRes!.executionResult.formattedOutput[0]; // Returns as a BN instance
    const bigNumberBal = new BigNumber(bnBal.toString(10)); // Convert to BigNumber instance
    const balance = bigNumberBal.dividedBy(new BigNumber(10 ** token.decimals)).toNumber(); // Convert to regular denomination

    // Update token balance in place
    const index = findIndex(this.tokens, { name: token.name, symbol: token.symbol });
    if (index !== -1) {
      this.tokens![index].balance = balance;
    }

    chrome.runtime.sendMessage({ type: MESSAGE_TYPE.FGC_TOKENS_RETURN, tokens: this.tokens });
  }

  /**
   * Gets the FGC token details (name, symbol, decimals) given a contract address.
   * @param {string} contractAddress FGC token contract address.
   */
  private getFGCTokenDetails = async (contractAddress: string) => {
    let msg;

    /*
    * Further contract address validation - if the addr provided does not have name,
    * symbol, and decimals fields, it will throw an error as it is not a valid
    * fgc20TokenContractAddr
    */
    try {
      // Get name
      let methodName = 'name';
      let data = fgcweb3.encoder.constructData(fgc20TokenABI, methodName, []);
      let { result, error }: IRPCCallResponse =
        await this.main.rpc.callContract(generateRequestId(), [contractAddress, data]);
      if (error) {
        throw Error(error);
      }
      result = fgcweb3.decoder.decodeCall(result, fgc20TokenABI, methodName) as Insight.IContractCall;
      const name = result.executionResult.formattedOutput[0];

      // Get symbol
      methodName = 'symbol';
      data = fgcweb3.encoder.constructData(fgc20TokenABI, methodName, []);
      ({ result, error } = await this.main.rpc.callContract(generateRequestId(), [contractAddress, data]));
      if (error) {
        throw Error(error);
      }
      result = fgcweb3.decoder.decodeCall(result, fgc20TokenABI, methodName) as Insight.IContractCall;
      const symbol = result.executionResult.formattedOutput[0];

      // Get decimals
      methodName = 'decimals';
      data = fgcweb3.encoder.constructData(fgc20TokenABI, methodName, []);
      ({ result, error } = await this.main.rpc.callContract(generateRequestId(), [contractAddress, data]));
      if (error) {
        throw Error(error);
      }
      result = fgcweb3.decoder.decodeCall(result, fgc20TokenABI, methodName) as Insight.IContractCall;
      const decimals = result.executionResult.formattedOutput[0];

      if (name && symbol && decimals) {
        const token = new FGCToken(name, symbol, decimals, contractAddress);
        msg = {
          type: MESSAGE_TYPE.FGC_TOKEN_DETAILS_RETURN,
          isValid: true,
          token,
        };
      } else {
        msg = {
          type: MESSAGE_TYPE.FGC_TOKEN_DETAILS_RETURN,
          isValid: false,
        };
      }
    } catch (err) {
      console.error(err);
      msg = {
        type: MESSAGE_TYPE.FGC_TOKEN_DETAILS_RETURN,
        isValid: false,
      };
    }

    chrome.runtime.sendMessage(msg);
  }

  /*
  * Send FGC tokens.
  * @param receiverAddress The receiver of the send.
  * @param amount The amount to send in decimal format. (unit - whole token)
  * @param token The FGC token being sent.
  * @param gasLimit (unit - gas)
  * @param gasPrice (unit - satoshi/gas)
  */
  private sendFGCToken = async (receiverAddress: string, amount: number, token: FGCToken,
                                gasLimit: number, gasPrice: number ) => {
    // bn.js does not handle decimals well (Ex: BN(1.2) => 1 not 1.2) so we use BigNumber
    const bnAmount = new BigNumber(amount).times(new BigNumber(10 ** token.decimals));
    const data = fgcweb3.encoder.constructData(fgc20TokenABI, 'transfer', [receiverAddress, bnAmount]);
    const args = [token.address, data, null, gasLimit, gasPrice];
    const { error } = await this.main.rpc.sendToContract(generateRequestId(), args);

    if (error) {
      console.error(error);
      chrome.runtime.sendMessage({ type: MESSAGE_TYPE.SEND_TOKENS_FAILURE, error });
      return;
    }

    chrome.runtime.sendMessage({ type: MESSAGE_TYPE.SEND_TOKENS_SUCCESS });
  }

  private addToken = async (contractAddress: string, name: string, symbol: string, decimals: number) => {
    const newToken = new FGCToken(name, symbol, decimals, contractAddress);
    this.tokens!.push(newToken);
    this.setTokenListInChromeStorage();
    await this.getFGCTokenBalance(newToken);
  }

  private removeToken = (contractAddress: string) => {
    const index = findIndex(this.tokens, { address: contractAddress });
    this.tokens!.splice(index, 1);
    this.setTokenListInChromeStorage();
  }

  private setTokenListInChromeStorage = () => {
    chrome.storage.local.set({
      [this.chromeStorageAccountTokenListKey()]: this.tokens,
    }, () => {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.FGC_TOKENS_RETURN,
        tokens: this.tokens,
      });
    });
  }

  private chromeStorageAccountTokenListKey = () => {
    return `${STORAGE.ACCOUNT_TOKEN_LIST}-${this.main.account.loggedInAccount!.name}-${this.main.network.networkName}`;
  }

  private handleMessage = (request: any, _: chrome.runtime.MessageSender, sendResponse: (response: any) => void) => {
    try {
      switch (request.type) {
        case MESSAGE_TYPE.GET_FGC_TOKEN_LIST:
          sendResponse(this.tokens);
          break;
        case MESSAGE_TYPE.SEND_FGC_TOKENS:
          this.sendFGCToken(request.receiverAddress, request.amount, request.token, request.gasLimit, request.gasPrice);
          break;
        case MESSAGE_TYPE.ADD_TOKEN:
          this.addToken(request.contractAddress, request.name, request.symbol, request.decimals);
          break;
        case MESSAGE_TYPE.GET_FGC_TOKEN_DETAILS:
          this.getFGCTokenDetails(request.contractAddress);
          break;
        case MESSAGE_TYPE.REMOVE_TOKEN:
          this.removeToken(request.contractAddress);
          break;
        default:
          break;
      }
    } catch (err) {
      console.error(err);
      this.main.displayErrorOnPopup(err);
    }
  }
}

import axios from 'axios';

import FGCLiteController from '.';
import IController from './iController';
import { MESSAGE_TYPE } from '../../constants';

const INIT_VALUES = {
  getPriceInterval: undefined,
  fantasygoldPriceUSD: 0,
};

export default class ExternalController extends IController {
  private static GET_PRICE_INTERVAL_MS: number = 60000;

  private getPriceInterval?: number = INIT_VALUES.getPriceInterval;
  private fantasygoldPriceUSD: number = INIT_VALUES.fantasygoldPriceUSD;

  constructor(main: FGCLiteController) {
    super('external', main);
    this.initFinished();
  }

  public calculateFantasyGoldToUSD = (balance: number): number => {
    return this.fantasygoldPriceUSD ? Number((this.fantasygoldPriceUSD * balance).toFixed(2)) : 0;
  }

  /*
  * Starts polling for periodic info updates.
  */
  public startPolling = async () => {
    await this.getFantasyGoldPrice();
    if (!this.getPriceInterval) {
      this.getPriceInterval = window.setInterval(() => {
        this.getFantasyGoldPrice();
      }, ExternalController.GET_PRICE_INTERVAL_MS);
    }
  }

  /*
  * Stops polling for the periodic info updates.
  */
  public stopPolling = () => {
    if (this.getPriceInterval) {
      clearInterval(this.getPriceInterval);
      this.getPriceInterval = undefined;
    }
  }

  /*
  * Gets the current FantasyGold market price.
  */
  private getFantasyGoldPrice = async () => {
    try {
      const jsonObj = await axios.get('https://api.coinmarketcap.com/v2/ticker/2870/');
      this.fantasygoldPriceUSD = jsonObj.data.data.quotes.USD.price;

      if (this.main.account.loggedInAccount
        && this.main.account.loggedInAccount.wallet
        && this.main.account.loggedInAccount.wallet.info
      ) {
        const fantasygoldUSD = this.calculateFantasyGoldToUSD(this.main.account.loggedInAccount.wallet.info.balance);
        this.main.account.loggedInAccount.wallet.fantasygoldUSD = fantasygoldUSD;

        chrome.runtime.sendMessage({
          type: MESSAGE_TYPE.GET_FGC_USD_RETURN,
          fantasygoldUSD,
        });
      }
    } catch (err) {
      console.log(err);
    }
  }
}

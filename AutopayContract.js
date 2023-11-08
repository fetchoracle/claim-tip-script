const ethers = require("ethers");
const { readFileSync } = require("node:fs");
const path = require("node:path");

class AutopayContract {
  constructor() {
    this.autopay = null;
  }

  async initializeAsync() {
    const abiJSONFile = path.resolve(
      __dirname,
      "artifacts/contracts/Autopay.sol/Autopay.json"
    );
    const { bytecode, abi } = JSON.parse(readFileSync(abiJSONFile));

    const autopayAddress = process.env.AUTOPAY_ADDRESS;

    const providerURL = process.env.PULSE_NETWORK_URL;

    const privateKey = process.env.ACCT_PRIVATE_KEY;
    const provider = new ethers.JsonRpcProvider(providerURL);
    const wallet = new ethers.Wallet(privateKey, provider);

    const Autopay = new ethers.ContractFactory(abi, bytecode, wallet);

    const autopayWithSigner = Autopay.connect(wallet);
    const autopay = autopayWithSigner.attach(autopayAddress);
    console.log("AutoPay deployed to:", await autopay.getAddress());

    this.autopay = autopay;
  }

  listenForOneTimeTipClaimed() {
    console.log("Listening for OneTimeTipClaimed events...");

    this.autopay.on("OneTimeTipClaimed", (queryId, amount, reporter) => {
      console.log("--------------------");
      console.log("OneTimeTipClaimed event emitted");
      console.log("queryId:", queryId);
      console.log("amount:", amount.toString());
      console.log("reporter:", reporter);
      console.log("--------------------");
    });
  }

  listenForTipClaimed() {
    console.log("Listening for TipClaimed events...");

    this.autopay.on("TipClaimed", (_feedId, queryId, amount, reporter) => {
      console.log("--------------------");
      console.log("TipClaimed event emitted");
      console.log("feedId:", _feedId);
      console.log("queryId:", queryId);
      console.log("amount:", amount.toString());
      console.log("reporter:", reporter);
      console.log("--------------------");
    });
  }

  static async create() {
    const instance = new AutopayContract();
    await instance.initializeAsync();
    return instance;
  }

  async claimOneTimeTip(queryId, reportsTimestamps) {
    await this.autopay.claimOneTimeTip(queryId, reportsTimestamps);
  }

  async getDecodedPastTips(queryId) {
    const pastTips = await this.autopay.getPastTips(queryId);

    const decodedPastTips = pastTips.map(
      ([amount, timestamp, cumulativeTips]) => ({
        amount: Number(amount),
        timestamp: Number(timestamp),
        cumulativeTips,
      })
    );
    return decodedPastTips;
  }

  async getCurrentFeeds(queryId) {
    return await this.autopay.getCurrentFeeds(queryId);
  }

  async getDataFeed(feedId) {
    return await this.autopay.getDataFeed(feedId);
  }

  async getFundedFeedDetails() {
    return await this.autopay.getFundedFeedDetails();
  }

  async getRewardClaimStatusList(feedId, queryId, reportsTimestamps) {
    const rewardsStatus = await this.autopay.getRewardClaimStatusList(
      feedId,
      queryId,
      reportsTimestamps
    );
    return rewardsStatus;
  }

  async claimTip(feedId, queryId, reportsTimestamps) {
    return await this.autopay.claimTip(feedId, queryId, reportsTimestamps);
  }
}

exports.AutopayContract = AutopayContract;

const { GraphQLClient } = require("graphql-request");

const flexSubgraphUri = process.env.REACT_APP_DATAFEED_FLEX_SUBGRAPH_BASEURL;
const autopaySubgraphUri = process.env.REACT_APP_DATAFEED_AUTOPAY_SUBGRAPH_BASEURL;

if (!flexSubgraphUri) {
  console.log("REACT_APP_DATAFEED_FLEX_SUBGRAPH_BASEURL env variable is not set");
  process.exit(1);
}

if (!autopaySubgraphUri) {
  console.log("REACT_APP_DATAFEED_AUTOPAY_SUBGRAPH_BASEURL env variable is not set");
  process.exit(1);
}

const flexClient = new GraphQLClient(flexSubgraphUri);
const autopayClient = new GraphQLClient(autopaySubgraphUri);

exports.flexClient = flexClient;
exports.autopayClient = autopayClient;

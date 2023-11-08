const dayjs = require("dayjs");

function getFormattedTimestamp(unix_timestamp) {
  const date = dayjs.unix(unix_timestamp);
  return date.format("MMMM DD, YYYY h:mm:ss A");
}

function getYesterdayUnixTimestamp() {
  const yesterday = dayjs().subtract(1, "day");
  return yesterday.unix();
}

exports.getFormattedTimestamp = getFormattedTimestamp;
exports.getYesterdayUnixTimestamp = getYesterdayUnixTimestamp;

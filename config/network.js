const net = require("net"),
  original = net.Socket.prototype.connect;
const allowed = (host, port) => host === "127.0.0.1" && Number(port) === 55439;
net.Socket.prototype.connect = function (...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  const host =
    typeof o === "object"
      ? o.host
      : typeof args[1] === "string"
        ? args[1]
        : "localhost";
  const port = typeof o === "object" ? o.port : o;
  if (!allowed(host, port)) throw Error("DEV_EGRESS_BLOCKED");
  return original.apply(this, args);
};
global.fetch = async () => {
  throw Error("DEV_EGRESS_BLOCKED");
};
module.exports = { allowed };

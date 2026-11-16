const fs = require("fs"),
  path = require("path"),
  config = require("./runtime"), {runtime}=config;
function vaultKey() {
  if(config.production)return Buffer.from(config.vaultKey,'hex');
  const value = fs
    .readFileSync(path.join(runtime, "capsule-vault.key"), "utf8")
    .trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw Error("Invalid capsule vault key");
  return Buffer.from(value, "hex");
}
module.exports = { vaultKey };

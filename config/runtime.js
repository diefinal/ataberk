// DEV remains fail-closed. Production never reads the local .env or runtime files.
module.exports =
  process.env.APP_ENV === "production"
    ? require("./production").validate(process.env)
    : require("./dev");

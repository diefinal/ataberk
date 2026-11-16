const NAMESPACE = "ataberkin-dunyasi/v1";
const kinds = new Set(["private-media", "avatars", "voice-notes"]);
function identity(kind, key, mime) {
  if (
    !kinds.has(kind) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(key)
  )
    throw Error("Invalid private storage key");
  const types = {
    "image/jpeg": ["image", "jpg"],
    "image/png": ["image", "png"],
    "video/mp4": ["video", "mp4"],
    "audio/wav": ["video", "wav"],
  };
  const type = types[mime];
  if (!type) throw Error("Unsupported private media type");
  if (
    (kind === "avatars" && mime !== "image/png") ||
    (kind === "voice-notes" && mime !== "audio/wav")
  )
    throw Error("Invalid storage type");
  return {
    publicId: `${NAMESPACE}/${kind}/${key}`,
    resource: type[0],
    format: type[1],
  };
}
function createCloudStorage({
  credentials,
  sdk,
  fetcher = global.fetch,
  maxBytes = 32 * 1024 * 1024,
}) {
  const cloud = sdk || require("cloudinary").v2,
    created = new Map();
  async function put(kind, key, bytes, mime) {
    const ident = identity(kind, key, mime);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maxBytes)
      throw Error("Private media size limit exceeded");
    const result = await new Promise((resolve, reject) => {
      const stream = cloud.uploader.upload_stream(
        {
          ...credentials,
          secure: true,
          public_id: ident.publicId,
          resource_type: ident.resource,
          type: "authenticated",
          overwrite: false,
          unique_filename: false,
          invalidate: false,
        },
        (error, result) =>
          error
            ? reject(Error("Private cloud upload failed"))
            : resolve(result),
      );
      stream.on("error", () => reject(Error("Private cloud upload failed")));
      stream.end(bytes);
    });
    if (
      result?.public_id !== ident.publicId ||
      result.type !== "authenticated" ||
      result.resource_type !== ident.resource ||
      !result.asset_id
    )
      throw Error("Cloud did not confirm private media");
    created.set(ident.publicId, { ...ident, assetId: result.asset_id });
  }
  async function read(kind, key, mime) {
    const ident = identity(kind, key, mime);
    const address = cloud.utils.private_download_url(
      ident.publicId,
      ident.format,
      {
        ...credentials,
        secure: true,
        resource_type: ident.resource,
        type: "authenticated",
        expires_at: Math.floor(Date.now() / 1000) + 60,
        attachment: false,
      },
    );
    const url = new URL(address);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "api.cloudinary.com" ||
      url.username ||
      url.password
    )
      throw Error("Invalid cloud download origin");
    let response;
    try {
      response = await fetcher(address, {
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw Error("Private cloud download failed");
    }
    if (!response.ok) throw Error("Private cloud download failed");
    const length = Number(response.headers.get("content-length"));
    if (length > maxBytes) throw Error("Private media size limit exceeded");
    const reader = response.body.getReader(),
      parts = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel();
          throw Error("Private media size limit exceeded");
        }
        parts.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(parts, size);
  }
  // Rollback is deliberately limited to assets uploaded by this process. No legacy asset API.
  async function rollback(kind, key, mime) {
    const ident = identity(kind, key, mime),
      item = created.get(ident.publicId);
    if (!item) return;
    await cloud.uploader.destroy(ident.publicId, {
      ...credentials,
      resource_type: ident.resource,
      type: "authenticated",
      invalidate: true,
    });
    created.delete(ident.publicId);
  }
  return { put, read, rollback };
}
module.exports = { createCloudStorage, identity, NAMESPACE };

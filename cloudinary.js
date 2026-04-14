const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function uploadStream(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    Readable.from(buffer).pipe(stream);
  });
}

async function uploadFile(buffer, mimetype, originalname) {
  const isVideo = mimetype.startsWith('video/');
  const result = await uploadStream(buffer, {
    resource_type: isVideo ? 'video' : 'image',
    folder: 'ataberktasci',
    use_filename: false,
  });
  return {
    url: result.secure_url,
    public_id: result.public_id,
    resource_type: result.resource_type,
  };
}

async function deleteFile(public_id, resource_type = 'image') {
  await cloudinary.uploader.destroy(public_id, { resource_type });
}

module.exports = { uploadFile, deleteFile };

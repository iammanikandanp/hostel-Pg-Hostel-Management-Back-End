const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    if (file.fieldname === 'complaintPhotos') {
      return { folder: 'hostel-complaints', allowed_formats: ['jpg', 'jpeg', 'png', 'webp'], resource_type: 'image' };
    }
    return {
      folder: file.fieldname === 'profilePhoto' ? 'hostel-profiles' : 'hostel-id-proofs',
      allowed_formats: file.fieldname === 'profilePhoto'
        ? ['jpg', 'jpeg', 'png']
        : ['jpg', 'jpeg', 'png', 'pdf'],
      resource_type: 'auto',
      access_mode: 'authenticated',
    };
  },
});

const hstUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedImages = ['image/jpeg', 'image/png', 'image/webp'];
    const allowedDocs   = ['image/jpeg', 'image/png', 'application/pdf'];
    if (file.fieldname === 'complaintPhotos') {
      return allowedImages.includes(file.mimetype) ? cb(null, true) : cb(new Error('Invalid file type'));
    }
    const allowed = file.fieldname === 'profilePhoto' ? allowedImages : allowedDocs;
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Invalid file type'));
  },
});

module.exports = hstUpload;

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let dest = 'public/uploads';
    if (file.fieldname === 'vehicle_photo') {
      dest = 'public/uploads/vehicles';
    } else if (file.fieldname === 'document') {
      dest = 'public/uploads/documents';
    } else if (file.fieldname === 'inspection') {
      dest = 'public/uploads/inspections';
    } else if (file.fieldname === 'profile') {
      dest = 'public/uploads/profiles';
    } else if (file.fieldname === 'booking_media') {
      dest = 'public/uploads/bookings';
    }
    const fullPath = path.resolve(dest);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    cb(null, fullPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
    cb(null, unique);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|webp|pdf|mp4|mov|avi/;
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Allowed: jpg, png, webp, pdf, mp4, mov, avi'));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  fileFilter
});

module.exports = upload;

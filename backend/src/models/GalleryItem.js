const mongoose = require("mongoose");

const galleryItemSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    imageUrl: { type: String, required: true },
    tags: [{ type: String }]
  },
  { timestamps: true }
);

module.exports = mongoose.model("GalleryItem", galleryItemSchema);


const mongoose = require("mongoose");

const deliverySchema = new mongoose.Schema(
  {
    trackingId: {
      type: String,
      required: true,
      unique: true
    },
    customer: {
      type: String,
      required: true,
      trim: true
    },
    pickup: {
      type: String,
      required: true,
      trim: true
    },
    destination: {
      type: String,
      required: true,
      trim: true
    },
    driverId: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: [
        "Pending",
        "Assigned",
        "Picked Up",
        "In Transit",
        "Delivered"
      ],
      default: "Pending"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Delivery", deliverySchema);

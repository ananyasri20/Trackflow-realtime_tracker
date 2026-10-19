
console.log("TrackFlow app is starting...");
require("dotenv").config();
const express = require("express");
const path = require("path");
const http = require("http");
const { randomUUID } = require("crypto");
const { Server } = require("socket.io");
const connectDB = require("./config/db");
const Delivery = require("./models/Delivery");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Temporary in-memory data
const drivers = new Map();
const deliveries = new Map();

const deliveryStatuses = [
    "Pending",
    "Assigned",
    "Picked Up",
    "In Transit",
    "Delivered"
];

// Home page
app.get("/", (req, res) => {
    res.render("index");
});

// Dashboard API

app.get("/api/dashboard", async (req, res) => {
  try {
    const allDeliveries = await Delivery.find()
      .sort({ createdAt: -1 })
      .lean();

    const allDrivers = [...drivers.values()];

    res.json({
      drivers: allDrivers,
      deliveries: allDeliveries.map(d => ({
        ...d,
        id: d._id.toString()
      })),
      stats: {
        total: allDeliveries.length,
        activeDrivers: allDrivers.length,
        pending: allDeliveries.filter(
          d => d.status === "Pending"
        ).length,
        completed: allDeliveries.filter(
          d => d.status === "Delivered"
        ).length
      }
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({
      error: "Failed to load dashboard."
    });
  }
});


// Create delivery

app.post("/api/deliveries", async (req, res) => {
  try {
    const { customer, pickup, destination } = req.body;

    if (
      ![customer, pickup, destination].every(
        value =>
          typeof value === "string" && value.trim()
      )
    ) {
      return res.status(400).json({
        error: "Customer, pickup and destination are required."
      });
    }

    const delivery = await Delivery.create({
      trackingId: randomUUID()
        .slice(0, 8)
        .toUpperCase(),
      customer: customer.trim(),
      pickup: pickup.trim(),
      destination: destination.trim(),
      driverId: null,
      status: "Pending"
    });

    const result = {
      ...delivery.toObject(),
      id: delivery._id.toString()
    };

    io.emit("delivery-updated", result);
    res.status(201).json(result);
  } catch (error) {
    console.error("Create delivery error:", error);
    res.status(500).json({
      error: "Failed to save delivery."
    });
  }
});


// Assign delivery to a driver

app.patch("/api/deliveries/:id/assign", async (req, res) => {
  try {
    const { driverId } = req.body;

    if (!drivers.has(driverId)) {
      return res.status(404).json({
        error: "Driver not found."
      });
    }

    const delivery = await Delivery.findByIdAndUpdate(
      req.params.id,
      {
        driverId,
        status: "Assigned"
      },
      { new: true, runValidators: true }
    );

    if (!delivery) {
      return res.status(404).json({
        error: "Delivery not found."
      });
    }

    const result = {
      ...delivery.toObject(),
      id: delivery._id.toString()
    };

    io.emit("delivery-updated", result);
    res.json(result);
  } catch (error) {
    console.error("Assign driver error:", error);
    res.status(500).json({
      error: "Failed to assign driver."
    });
  }
});


// Update delivery status

app.patch("/api/deliveries/:id/status", async (req, res) => {
  try {
    const { status } = req.body;

    if (!deliveryStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid delivery status."
      });
    }

    const delivery = await Delivery.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!delivery) {
      return res.status(404).json({
        error: "Delivery not found."
      });
    }

    const result = {
      ...delivery.toObject(),
      id: delivery._id.toString()
    };

    io.emit("delivery-updated", result);
    res.json(result);
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({
      error: "Failed to update delivery status."
    });
  }
});


// Socket.IO
io.on("connection", socket => {
    console.log("Driver connected:", socket.id);

    drivers.set(socket.id, {
        id: socket.id,
        online: true,
        latitude: null,
        longitude: null,
        lastUpdated: null
    });

    io.emit("drivers-updated", [...drivers.values()]);

    // Receive GPS coordinates
    socket.on("send-location", data => {
        const latitude = data?.latitude;
        const longitude = data?.longitude;

        if (
            typeof latitude !== "number" ||
            typeof longitude !== "number" ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            Math.abs(latitude) > 90 ||
            Math.abs(longitude) > 180
        ) {
            return;
        }

        const driver = drivers.get(socket.id);
        if (!driver) return;

        driver.latitude = latitude;
        driver.longitude = longitude;
        driver.lastUpdated = new Date().toISOString();

        io.emit("receive-location", {
            id: socket.id,
            latitude,
            longitude,
            lastUpdated: driver.lastUpdated
        });
    });

    // Handle disconnect
    socket.on("disconnect", () => {
        console.log("Driver disconnected:", socket.id);

        drivers.delete(socket.id);

        io.emit("user-disconnected", socket.id);
        io.emit("drivers-updated", [...drivers.values()]);
    });
});

// Start server

 // Start server only after MongoDB connects
async function startServer() {
    try {
        await connectDB();

        server.listen(PORT, () => {
            console.log(`TrackFlow running on port ${PORT}`);
        });
    } catch (error) {
        console.error("TrackFlow startup failed:", error.message);
        process.exit(1);
    }
}

startServer();
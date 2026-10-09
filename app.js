
console.log("TrackFlow app is starting...");

const express = require("express");
const path = require("path");
const http = require("http");
const { randomUUID } = require("crypto");
const { Server } = require("socket.io");

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
app.get("/api/dashboard", (req, res) => {
    const allDeliveries = [...deliveries.values()];
    const allDrivers = [...drivers.values()];

    res.json({
        drivers: allDrivers,
        deliveries: allDeliveries,
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
});

// Create delivery
app.post("/api/deliveries", (req, res) => {
    const { customer, pickup, destination } = req.body;

    if (
        ![customer, pickup, destination].every(
            value => typeof value === "string" && value.trim()
        )
    ) {
        return res.status(400).json({
            error: "Customer, pickup and destination are required."
        });
    }

    const delivery = {
        id: randomUUID(),
        trackingId: randomUUID().slice(0, 8).toUpperCase(),
        customer: customer.trim(),
        pickup: pickup.trim(),
        destination: destination.trim(),
        driverId: null,
        status: "Pending",
        createdAt: new Date().toISOString()
    };

    deliveries.set(delivery.id, delivery);

    io.emit("delivery-updated", delivery);
    res.status(201).json(delivery);
});

// Assign delivery to a driver
app.patch("/api/deliveries/:id/assign", (req, res) => {
    const delivery = deliveries.get(req.params.id);
    const { driverId } = req.body;

    if (!delivery) {
        return res.status(404).json({
            error: "Delivery not found."
        });
    }

    if (!drivers.has(driverId)) {
        return res.status(404).json({
            error: "Driver not found."
        });
    }

    delivery.driverId = driverId;
    delivery.status = "Assigned";

    deliveries.set(delivery.id, delivery);
    io.emit("delivery-updated", delivery);

    res.json(delivery);
});

// Update delivery status
app.patch("/api/deliveries/:id/status", (req, res) => {
    const delivery = deliveries.get(req.params.id);
    const { status } = req.body;

    if (!delivery) {
        return res.status(404).json({
            error: "Delivery not found."
        });
    }

    if (!deliveryStatuses.includes(status)) {
        return res.status(400).json({
            error: "Invalid delivery status."
        });
    }

    delivery.status = status;

    deliveries.set(delivery.id, delivery);
    io.emit("delivery-updated", delivery);

    res.json(delivery);
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
server.listen(PORT, () => {
    console.log(`TrackFlow running on port ${PORT}`);
});

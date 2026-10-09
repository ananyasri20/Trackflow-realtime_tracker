
const socket = io();

const map = L.map("map").setView([26.8467, 80.9462], 12);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const markers = {};
let drivers = [];
let deliveries = [];

const $ = id => document.getElementById(id);

// Socket connection status
socket.on("connect", () => {
    $("connection").textContent = "Connected";
    refreshDashboard();
});

socket.on("disconnect", () => {
    $("connection").textContent = "Disconnected";
});

// Receive GPS updates
socket.on("receive-location", data => {
    const { id, latitude, longitude } = data;

    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
    ) {
        console.error("Invalid GPS data:", data);
        return;
    }

    const position = [latitude, longitude];

    if (markers[id]) {
        markers[id].setLatLng(position);
    } else {
        markers[id] = L.marker(position)
            .addTo(map)
            .bindPopup(`Driver: ${id.slice(0, 8)}`);
    }

    const driver = drivers.find(d => d.id === id);

    if (driver) {
        driver.latitude = latitude;
        driver.longitude = longitude;
    }

    renderDrivers();
});

// Remove disconnected drivers
socket.on("user-disconnected", id => {
    if (markers[id]) {
        map.removeLayer(markers[id]);
        delete markers[id];
    }
});

// Update connected drivers
socket.on("drivers-updated", updatedDrivers => {
    drivers = updatedDrivers;

    const onlineIds = new Set(drivers.map(d => d.id));

    Object.keys(markers).forEach(id => {
        if (!onlineIds.has(id)) {
            map.removeLayer(markers[id]);
            delete markers[id];
        }
    });

    renderDrivers();
    renderDeliveries();
    renderStats();
});

// Update delivery records in real time
socket.on("delivery-updated", delivery => {
    const index = deliveries.findIndex(d => d.id === delivery.id);

    if (index === -1) {
        deliveries.unshift(delivery);
    } else {
        deliveries[index] = delivery;
    }

    renderDeliveries();
    renderStats();
});

// Load dashboard data
async function refreshDashboard() {
    try {
        const response = await fetch("/api/dashboard");

        if (!response.ok) {
            throw new Error("Unable to load dashboard");
        }

        const data = await response.json();

        deliveries = data.deliveries;
        drivers = data.drivers;

        renderStats();
        renderDrivers();
        renderDeliveries();
    } catch (error) {
        console.error(error);
    }
}

function renderStats() {
    $("total").textContent = deliveries.length;
    $("active").textContent = drivers.filter(d => d.online).length;
    $("pending").textContent = deliveries.filter(
        d => d.status === "Pending"
    ).length;
    $("completed").textContent = deliveries.filter(
        d => d.status === "Delivered"
    ).length;
}

function renderDrivers() {
    const container = $("drivers");
    container.replaceChildren();

    drivers.forEach(driver => {
        const item = document.createElement("div");
        item.className = "driver-item";

        const name = document.createElement("strong");
        name.textContent = `Driver ${driver.id.slice(0, 8)}`;

        const location = document.createElement("span");
        location.textContent =
            driver.latitude == null
                ? "Waiting for GPS..."
                : `${driver.latitude.toFixed(4)}, ${driver.longitude.toFixed(4)}`;

        item.append(name, location);
        container.appendChild(item);
    });
}

function renderDeliveries() {
    const tbody = $("delivery-rows");
    tbody.replaceChildren();

    deliveries.forEach(delivery => {
        const row = document.createElement("tr");

        const driver = drivers.find(d => d.id === delivery.driverId);

        const values = [
            delivery.trackingId,
            delivery.customer,
            delivery.destination,
            driver ? `Driver ${driver.id.slice(0, 8)}` : "Unassigned",
            delivery.status
        ];

        values.forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });

        const actions = document.createElement("td");
        const select = document.createElement("select");

        ["Pending", "Assigned", "Picked Up", "In Transit", "Delivered"]
            .forEach(status => {
                const option = document.createElement("option");
                option.value = status;
                option.textContent = status;
                option.selected = delivery.status === status;
                select.appendChild(option);
            });

        select.addEventListener("change", async () => {
            try {
                const response = await fetch(
                    `/api/deliveries/${encodeURIComponent(delivery.id)}/status`,
                    {
                        method: "PATCH",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ status: select.value })
                    }
                );

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.error);
                }

                $("form-message").textContent = "Delivery status updated.";
                await refreshDashboard();
            } catch (error) {
                $("form-message").textContent = error.message;
            }
        });

        actions.appendChild(select);
        row.appendChild(actions);
        tbody.appendChild(row);
    });

    renderStats();
}

// Create a delivery
$("delivery-form").addEventListener("submit", async event => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());

    try {
        const response = await fetch("/api/deliveries", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error);
        }

        $("form-message").textContent =
            `Delivery created! Tracking ID: ${result.trackingId}`;

        event.currentTarget.reset();
        await refreshDashboard();
    } catch (error) {
        $("form-message").textContent = error.message;
    }
});

// Share browser location
if ("geolocation" in navigator) {
    navigator.geolocation.watchPosition(
        position => {
            socket.emit("send-location", {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            });
        },
        error => {
            console.error("GPS error:", error.message);
            $("connection").textContent =
                `Location unavailable: ${error.message}`;
        },
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 3000
        }
    );
} else {
    $("connection").textContent = "GPS unsupported";
}

refreshDashboard();

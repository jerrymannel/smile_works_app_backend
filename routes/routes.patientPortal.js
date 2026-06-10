const router = require("express").Router();
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const moment = require("moment");
const init = require("../init");
const { updateMetadata } = require("../lib/metadataHandler");

// Models are registered by their own route files (loaded before this one in app.js).
// We resolve them lazily on the first request to avoid "model not yet compiled" errors.
let Patient, Appointment, Treatment;
router.use((req, res, next) => {
    if (!Patient) Patient = mongoose.model(init.modelNames.patient);
    if (!Appointment) Appointment = mongoose.model(init.modelNames.appointment);
    if (!Treatment) Treatment = mongoose.model(init.modelNames.treatment);
    next();
});

// --- Patient auth middleware (applied to all routes except login & change-password) ---
function patientAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: "Unauthorized - No token provided" });
    }

    try {
        const token = authHeader.split(" ")[1];

        const blacklistedTokens = req.app.get("blacklistedTokens");
        if (blacklistedTokens.has(token)) {
            return res.status(401).json({ message: "Unauthorized - Token has been logged out" });
        }

        const tokenData = jwt.verify(token, init.auth.jwtTokenSecret);
        if (!tokenData || tokenData.role !== "patient") {
            return res.status(403).json({ message: "Forbidden - Patient access only" });
        }

        req.patientId = tokenData.patientId;
        req.user = tokenData.patientId; // used by updateMetadata for updatedBy audit field
        next();
    } catch (err) {
        return res.status(401).json({ message: "Unauthorized - Invalid token" });
    }
}

// --- POST /login ---
router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
    }

    try {
        const patient = await Patient.findOne({ email, "_metadata.isDeleted": false });
        if (!patient) {
            return res.status(401).json({ message: "Invalid credentials" });
        }
        if (!patient.password) {
            return res.status(401).json({ message: "Account not activated. Contact the clinic to set up your password." });
        }

        const hashed = crypto.createHash("sha256").update(password + patient.salt).digest("hex");
        if (hashed !== patient.password) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const token = jwt.sign(
            { patientId: patient._id, role: "patient" },
            init.auth.jwtTokenSecret,
            { expiresIn: init.auth.jwtTokenExpiry }
        );
        res.status(200).json({ token, name: patient.name });
    } catch (err) {
        init.logger.error(err);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- POST /change-password ---
router.post("/change-password", patientAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "currentPassword and newPassword are required" });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ message: "New password must be at least 8 characters" });
    }

    try {
        const patient = await Patient.findById(req.patientId);
        if (!patient) return res.status(404).json({ message: "Patient not found" });

        if (patient.password) {
            const hashed = crypto.createHash("sha256").update(currentPassword + patient.salt).digest("hex");
            if (hashed !== patient.password) {
                return res.status(401).json({ message: "Current password is incorrect" });
            }
        }

        const newSalt = Date.now().toString();
        const newHashed = crypto.createHash("sha256").update(newPassword + newSalt).digest("hex");

        patient.salt = newSalt;
        patient.password = newHashed;
        patient._metadata = updateMetadata(req, patient._metadata);
        await patient.save();

        res.status(200).json({ message: "Password updated successfully" });
    } catch (err) {
        init.logger.error(err);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- GET /me ---
router.get("/me", patientAuth, async (req, res) => {
    try {
        const patient = await Patient.findOne({ _id: req.patientId, "_metadata.isDeleted": false })
            .select("-password -salt");
        if (!patient) return res.status(404).json({ message: "Patient not found" });
        res.status(200).json(patient);
    } catch (err) {
        init.logger.error(err);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- PUT /me/contact ---
router.put("/me/contact", patientAuth, async (req, res) => {
    const allowed = ["name", "phoneNumber", "email", "address"];
    const update = {};
    for (const field of allowed) {
        if (req.body[field] !== undefined) update[field] = req.body[field];
    }

    try {
        const patient = await Patient.findOne({ _id: req.patientId, "_metadata.isDeleted": false });
        if (!patient) return res.status(404).json({ message: "Patient not found" });

        Object.assign(patient, update);
        patient._metadata = updateMetadata(req, patient._metadata);
        await patient.save();

        const result = patient.toObject();
        delete result.password;
        delete result.salt;
        res.status(200).json(result);
    } catch (err) {
        init.logger.error(err);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- PUT /me/emergency-contact ---
router.put("/me/emergency-contact", patientAuth, async (req, res) => {
    const { name, phoneNumber } = req.body;
    if (!name || !phoneNumber) {
        return res.status(400).json({ message: "name and phoneNumber are required" });
    }

    try {
        const patient = await Patient.findOne({ _id: req.patientId, "_metadata.isDeleted": false });
        if (!patient) return res.status(404).json({ message: "Patient not found" });

        patient.emergencyInfo = { name, phoneNumber };
        patient._metadata = updateMetadata(req, patient._metadata);
        await patient.save();

        res.status(200).json({ emergencyInfo: patient.emergencyInfo });
    } catch (err) {
        init.logger.error(err);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- PUT /me/insurance ---
router.put("/me/insurance", patientAuth, async (req, res) => {
    const { insuranceProvider, phoneNumber } = req.body;

    try {
        const patient = await Patient.findOne({ _id: req.patientId, "_metadata.isDeleted": false });
        if (!patient) return res.status(404).json({ message: "Patient not found" });

        patient.insuranceInfo = { insuranceProvider, phoneNumber };
        patient._metadata = updateMetadata(req, patient._metadata);
        await patient.save();

        res.status(200).json({ insuranceInfo: patient.insuranceInfo });
    } catch (err) {
        init.logger.error(err);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- PUT /me/notification-preferences ---
router.put("/me/notification-preferences", patientAuth, async (req, res) => {
    const { allowSMS, allowEmail, allowPhoneCall } = req.body;

    try {
        const patient = await Patient.findOne({ _id: req.patientId, "_metadata.isDeleted": false });
        if (!patient) return res.status(404).json({ message: "Patient not found" });

        if (allowSMS !== undefined) patient.notificationPreference.allowSMS = allowSMS;
        if (allowEmail !== undefined) patient.notificationPreference.allowEmail = allowEmail;
        if (allowPhoneCall !== undefined) patient.notificationPreference.allowPhoneCall = allowPhoneCall;

        patient._metadata = updateMetadata(req, patient._metadata);
        await patient.save();

        res.status(200).json({ notificationPreference: patient.notificationPreference });
    } catch (err) {
        init.logger.error(err);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- GET /me/appointments ---
router.get("/me/appointments", patientAuth, async (req, res) => {
    try {
        const { status, from, to } = req.query;
        const filter = { patientId: req.patientId, "_metadata.isDeleted": false };

        if (status) filter.status = status;
        if (from || to) {
            filter.date = {};
            if (from) filter.date.$gte = moment(from).startOf("day").toDate();
            if (to) filter.date.$lte = moment(to).endOf("day").toDate();
        }

        const appointments = await Appointment.find(filter).sort({ date: -1 });
        res.status(200).json(appointments);
    } catch (err) {
        init.logger.error(err);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- POST /me/appointments ---
router.post("/me/appointments", patientAuth, async (req, res) => {
    const { date, doctorId, treatmentMaster } = req.body;
    if (!date || !doctorId) {
        return res.status(400).json({ message: "date and doctorId are required" });
    }

    try {
        const conflict = await Appointment.findOne({ date: new Date(date), doctorId, "_metadata.isDeleted": false });
        if (conflict) {
            return res.status(409).json({ message: "That time slot is already booked" });
        }

        const appointment = new Appointment({
            ...req.body,
            patientId: req.patientId,
            status: "Confirmed",
            _metadata: {
                createdAt: Date.now(),
                lastUpdatedAt: Date.now(),
                updatedBy: req.patientId,
                isDeleted: false,
                version: 1,
            },
        });
        await appointment.save();
        res.status(201).json(appointment);
    } catch (err) {
        init.logger.error(err);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- PUT /me/appointments/:id/cancel ---
router.put("/me/appointments/:id/cancel", patientAuth, async (req, res) => {
    try {
        const appointment = await Appointment.findOne({
            _id: req.params.id,
            patientId: req.patientId,
            "_metadata.isDeleted": false,
        });

        if (!appointment) {
            return res.status(404).json({ message: "Appointment not found" });
        }
        if (appointment.status === "Cancelled") {
            return res.status(400).json({ message: "Appointment is already cancelled" });
        }
        if (moment(appointment.date).isBefore(moment())) {
            return res.status(400).json({ message: "Cannot cancel a past appointment" });
        }

        appointment.status = "Cancelled";
        appointment._metadata = updateMetadata(req, appointment._metadata);
        await appointment.save();

        res.status(200).json(appointment);
    } catch (err) {
        init.logger.error(err);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- GET /me/treatments ---
router.get("/me/treatments", patientAuth, async (req, res) => {
    try {
        const treatments = await Treatment.find({
            patientId: req.patientId,
            "_metadata.isDeleted": false,
        }).sort({ "_metadata.createdAt": -1 });
        res.status(200).json(treatments);
    } catch (err) {
        init.logger.error(err);
        res.status(500).json({ message: "Internal server error" });
    }
});

module.exports = router;

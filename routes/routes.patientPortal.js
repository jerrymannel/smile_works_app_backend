const router = require("express").Router();
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const moment = require("moment");
const init = require("../init");
const patientAuth = require("../lib/middleware.patientAuth");
const { updateMetadata } = require("../lib/metadataHandler");

const patientSchema = require("../schemas/schema.patient");
const appointmentSchema = require("../schemas/schema.appointment");
const billingSchema = require("../schemas/schema.billing");
const treatmentSchema = require("../schemas/schema.treatment");

const Patient = mongoose.model(init.modelNames.patient, patientSchema);
const Appointment = mongoose.model(init.modelNames.appointment, appointmentSchema);
const Billing = mongoose.model(init.modelNames.billing, billingSchema);
const Treatment = mongoose.model(init.modelNames.treatment, treatmentSchema);

// Fields patients are allowed to update on their own profile
const UPDATABLE_FIELDS = [
    "name", "dob", "allergies", "medicalHistory",
    "emergencyInfo", "address", "phoneNumber", "email",
    "notificationPreference",
];

function hashPassword(password, salt) {
    return crypto.createHash("sha256").update(password + salt).digest("hex");
}

// POST /api/patient-portal/register
// Patient sets their password for the first time, verified by email + dob
router.post("/register", async (req, res) => {
    const { email, dob, password } = req.body;

    if (!email || !dob || !password) {
        return res.status(400).json({ message: "email, dob, and password are required" });
    }

    try {
        const patient = await Patient.findOne({ email, dob, "_metadata.isDeleted": false });
        if (!patient) {
            return res.status(404).json({ message: "No patient record found matching that email and date of birth" });
        }

        if (patient.password) {
            return res.status(409).json({ message: "Password already set. Use login or contact the clinic to reset." });
        }

        const salt = Date.now().toString();
        patient.password = hashPassword(password, salt);
        patient.salt = salt;
        await patient.save();

        res.status(200).json({ message: "Password set successfully. You can now log in." });
    } catch (error) {
        init.logger.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

// POST /api/patient-portal/login
router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "email and password are required" });
    }

    try {
        const patient = await Patient.findOne({ email, "_metadata.isDeleted": false });
        if (!patient || !patient.password) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const hashed = hashPassword(password, patient.salt);
        if (hashed !== patient.password) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const token = jwt.sign(
            { id: patient._id, isPatient: true },
            init.auth.jwtTokenSecret,
            { expiresIn: init.auth.jwtTokenExpiry }
        );

        res.status(200).json({ token, name: patient.name });
    } catch (error) {
        init.logger.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

// GET /api/patient-portal/me
router.get("/me", patientAuth, async (req, res) => {
    try {
        const patient = await Patient
            .findOne({ _id: req.patientId, "_metadata.isDeleted": false })
            .select("-password -salt");

        if (!patient) {
            return res.status(404).json({ message: "Patient not found" });
        }

        res.status(200).json(patient);
    } catch (error) {
        init.logger.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

// PUT /api/patient-portal/me
router.put("/me", patientAuth, async (req, res) => {
    try {
        const patient = await Patient.findOne({ _id: req.patientId, "_metadata.isDeleted": false });
        if (!patient) {
            return res.status(404).json({ message: "Patient not found" });
        }

        for (const field of UPDATABLE_FIELDS) {
            if (req.body[field] !== undefined) {
                patient[field] = req.body[field];
            }
        }

        patient._metadata = updateMetadata(req, patient._metadata);
        await patient.save();

        const updated = patient.toObject();
        delete updated.password;
        delete updated.salt;

        res.status(200).json(updated);
    } catch (error) {
        init.logger.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

// GET /api/patient-portal/me/appointments
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
    } catch (error) {
        init.logger.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

// PUT /api/patient-portal/me/appointments/:id/cancel
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
    } catch (error) {
        init.logger.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

// GET /api/patient-portal/me/billing
router.get("/me/billing", patientAuth, async (req, res) => {
    try {
        const bills = await Billing.find({
            patientId: req.patientId,
            "_metadata.isDeleted": false,
        }).sort({ date: -1 });

        res.status(200).json(bills);
    } catch (error) {
        init.logger.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

// GET /api/patient-portal/me/treatments
router.get("/me/treatments", patientAuth, async (req, res) => {
    try {
        const treatments = await Treatment.find({
            patientId: req.patientId,
            "_metadata.isDeleted": false,
        }).sort({ "_metadata.createdAt": -1 });

        res.status(200).json(treatments);
    } catch (error) {
        init.logger.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

module.exports = router;

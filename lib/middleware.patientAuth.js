const jwt = require("jsonwebtoken");
const init = require("../init");

module.exports = function patientAuth(req, res, next) {
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

        const decoded = jwt.verify(token, init.auth.jwtTokenSecret);
        if (!decoded.isPatient) {
            return res.status(403).json({ message: "Forbidden - Patient access only" });
        }

        req.patientId = decoded.id;
        next();
    } catch (error) {
        return res.status(401).json({ message: "Unauthorized - Invalid token" });
    }
};

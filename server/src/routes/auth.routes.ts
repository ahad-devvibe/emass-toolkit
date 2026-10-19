import { Router } from "express";
import {
  captcha,
  forgotPassword,
  getMe,
  getSetPassword,
  login,
  logout,
  refresh,
  resendOtp,
  resendSetPassword,
  resetPassword,
  setPassword,
  signup,
  verifyOtp,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.get("/captcha", captcha);

router.post("/signup", signup);

router.post("/login", login);
router.post("/resend-otp", resendOtp);
router.post("/verify-otp", verifyOtp);

router.get("/set-password/:token", getSetPassword);
router.post("/set-password", setPassword);
router.post("/resend-set-password", resendSetPassword);

router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

router.post("/refresh", refresh);
router.post("/logout", logout);

router.get("/me", requireAuth, getMe);

export default router;

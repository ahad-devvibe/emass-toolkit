import { Router } from "express";
import {
  captcha,
  checkResetLink,
  forgotPassword,
  getMe,
  login,
  logout,
  refresh,
  resendOtp,
  resetPassword,
  signup,
  signupComplete,
  signupVerify,
  verifyOtp,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.get("/captcha", captcha);

router.post("/signup", signup);
router.post("/signup/verify", signupVerify);
router.post("/signup/complete", signupComplete);

router.post("/login", login);
router.post("/resend-otp", resendOtp);
router.post("/verify-otp", verifyOtp);

router.post("/forgot-password", forgotPassword);
router.post("/reset-password/check", checkResetLink);
router.post("/reset-password", resetPassword);

router.post("/refresh", refresh);
router.post("/logout", logout);

router.get("/me", requireAuth, getMe);

export default router;

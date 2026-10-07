import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../utils/respond.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { sendOtp, verifyOtp, publicUser, updateProfile, submitKyc, linkBank } from '../services/auth.js';
import { db } from '../store/db.js';

const r = Router();
const mobile = z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');

r.post('/send-otp', validate({ body: z.object({ mobile }) }), (req, res) => ok(res, sendOtp(req.body.mobile), { message: 'OTP sent' }));
r.post('/verify-otp', validate({ body: z.object({ mobile, otp: z.string().min(4).max(6), name: z.string().trim().max(80).optional() }) }), (req, res) => ok(res, verifyOtp(req.body), { message: 'Logged in' }));
r.get('/me', requireAuth, (req, res) => ok(res, publicUser(req.user)));
r.post('/logout', requireAuth, (req, res) => ok(res, { loggedOut: true }));

const address = z.object({ line1: z.string().trim().min(3), line2: z.string().trim().optional().default(''), landmark: z.string().trim().optional().default(''), city: z.string().trim().min(2), state: z.string().trim().min(2), pincode: z.string().regex(/^\d{6}$/) });
r.patch('/me', requireAuth, validate({ body: z.object({ name: z.string().trim().min(2).max(80).optional(), email: z.string().email().optional().or(z.literal('')), dob: z.string().optional(), anniversary: z.string().optional(), gender: z.enum(['M', 'F', 'O']).optional(), language: z.enum(['en', 'hi']).optional(), notificationsEnabled: z.boolean().optional(), address: address.optional() }) }), (req, res) => ok(res, updateProfile(req.user, req.body), { message: 'Profile updated' }));
r.put('/me/address', requireAuth, validate({ body: address }), (req, res) => ok(res, updateProfile(req.user, { address: req.body }), { message: 'Address saved' }));
r.post('/me/kyc', requireAuth, validate({ body: z.object({ pan: z.string().trim().toUpperCase(), panName: z.string().trim().min(2) }) }), (req, res) => ok(res, submitKyc(req.user, req.body), { message: 'KYC verified' }));
r.put('/me/bank', requireAuth, validate({ body: z.object({ holderName: z.string().trim().min(2), accountNumber: z.string().trim(), ifsc: z.string().trim().toUpperCase(), bankName: z.string().trim().optional() }) }), (req, res) => ok(res, linkBank(req.user, req.body), { message: 'Bank account linked' }));

export default r;

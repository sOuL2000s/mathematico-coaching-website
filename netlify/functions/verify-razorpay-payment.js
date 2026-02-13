// File: netlify/functions/verify-razorpay-payment.js

const Razorpay = require('razorpay');
const crypto = require('crypto');

// Firebase Admin SDK setup for secure Firestore access
const admin = require('firebase-admin');

if (!admin.apps.length) {
    try {
        // Sanitize the string: environments sometimes wrap JSON credentials in extra quotes
        const credentialsString = process.env.FIREBASE_ADMIN_CREDENTIALS.replace(/^'|'$/g, '');
        const serviceAccount = JSON.parse(credentialsString);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (e) {
        console.error("Failed to initialize Firebase Admin SDK:", e.message);
    }
}

const db = admin.firestore();

// Initialization must happen outside the handler for warm starts
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || process.env.VITE_RAZORPAY_KEY_SECRET;
const FIREBASE_APP_ID = process.env.VITE_FIREBASE_APP_ID; // Used for collection path

// Initialize Razorpay client (for optional payment fetching/status checks if needed)
// const instance = new Razorpay({
//     key_id: RAZORPAY_KEY_ID,
//     key_secret: RAZORPAY_KEY_SECRET,
// });

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const data = JSON.parse(event.body);
        const { 
            razorpay_payment_id, 
            razorpay_order_id, 
            razorpay_signature,
            courseId,
            courseTitle,
            courseDurationDays,
            userId,
            userEmail
        } = data;
        
        if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing Razorpay parameters.' }) };
        }
        
        if (!RAZORPAY_KEY_SECRET) {
            return { statusCode: 500, body: JSON.stringify({ error: 'Razorpay Secret Key missing.' }) };
        }

        // 1. Verify Signature
        const generated_signature = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest('hex');

        if (generated_signature !== razorpay_signature) {
            console.error("Signature mismatch:", generated_signature, razorpay_signature);
            return { statusCode: 400, body: JSON.stringify({ error: 'Payment signature verification failed.' }) };
        }

        // 2. Update Firestore Subscription for the user
        const userDocRef = db.collection(`artifacts/${FIREBASE_APP_ID}/public/data/users`).doc(userId);
        const userDocSnap = await userDocRef.get();

        if (!userDocSnap.exists) {
            console.error(`User document not found for ID: ${userId}`);
            // Payment is verified, but we can't update subscription safely.
            return { statusCode: 200, body: JSON.stringify({ message: 'Payment verified, but user profile update skipped (user not found in DB).' }) };
        }

        const userData = userDocSnap.data();
        let subscriptions = userData.subscriptions || [];
        
        const purchaseDate = new Date();
        const expiryDate = new Date(purchaseDate);
        expiryDate.setDate(purchaseDate.getDate() + courseDurationDays);
        expiryDate.setHours(23, 59, 59, 999); // Set to end of day

        // Check if subscription already exists for this course
        let existingSubIndex = subscriptions.findIndex(sub => sub.course_id === courseId);

        if (existingSubIndex !== -1) {
            // Update existing subscription (recharge/renew)
            subscriptions[existingSubIndex].purchase_date = purchaseDate;
            subscriptions[existingSubIndex].expiry_date = expiryDate;
        } else {
            // Add new subscription
            subscriptions.push({
                course_id: courseId,
                course_title: courseTitle,
                purchase_date: purchaseDate,
                expiry_date: expiryDate,
                razorpay_payment_id: razorpay_payment_id,
                razorpay_order_id: razorpay_order_id
            });
        }
        
        await userDocRef.update({
            subscriptions: subscriptions
        });

        // 3. Log the payment event
        await db.collection(`artifacts/${FIREBASE_APP_ID}/public/data/payments`).add({
            userId,
            userEmail,
            courseTitle,
            amount_paid_in_paise: data.amount, 
            payment_id: razorpay_payment_id,
            order_id: razorpay_order_id,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Payment verified and subscription activated.' }),
        };

    } catch (error) {
        console.error("Verification or DB Update Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'Internal server error during payment verification.' }),
        };
    }
};
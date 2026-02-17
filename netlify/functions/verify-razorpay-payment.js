// File: netlify/functions/verify-razorpay-payment.js

const Razorpay = require('razorpay');
const crypto = require('crypto');
const admin = require('firebase-admin');

if (!admin.apps.length) {
    try {
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

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || process.env.VITE_RAZORPAY_KEY_SECRET;
const FIREBASE_APP_ID = process.env.VITE_FIREBASE_APP_ID;

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
            orderItems, // <-- Expecting the array of items from the client
            userId,
            userEmail,
            amount // Total amount in paise
        } = data;
        
        if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !orderItems || orderItems.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing payment or cart parameters.' }) };
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

        const userDocRef = db.collection(`artifacts/${FIREBASE_APP_ID}/public/data/users`).doc(userId);
        const cartDocRef = db.collection(`artifacts/${FIREBASE_APP_ID}/public/data/carts`).doc(userId);
        const userDocSnap = await userDocRef.get();

        if (!userDocSnap.exists) {
            console.error(`User document not found for ID: ${userId}`);
            return { statusCode: 200, body: JSON.stringify({ message: 'Payment verified, but user profile update skipped (user not found in DB).' }) };
        }

        const userData = userDocSnap.data();
        let subscriptions = userData.subscriptions || [];
        const purchaseDate = admin.firestore.FieldValue.serverTimestamp();

        // 2. Process all items in the cart (Subscription/Product Activation)
        for (const item of orderItems) {
            const isSubscription = item.type === 'course' || item.type === 'subscription';
            
            let expiryDate = null;
            if (isSubscription && item.duration > 0) {
                // Calculate actual expiry date in the future
                const futureDate = new Date();
                futureDate.setDate(futureDate.getDate() + item.duration);
                futureDate.setHours(23, 59, 59, 999);
                expiryDate = futureDate; // Use JS Date for calculation, Firestore converts on update
            } 
            // Note: For non-subscription items or 0 duration, expiryDate remains null (perpetual access).

            let existingSubIndex = subscriptions.findIndex(sub => sub.course_id === item.id);

            if (existingSubIndex !== -1) {
                // Update existing subscription (renewal or update perpetual access)
                subscriptions[existingSubIndex].purchase_date = purchaseDate;
                subscriptions[existingSubIndex].expiry_date = expiryDate;
            } else {
                // Add new subscription
                subscriptions.push({
                    course_id: item.id,
                    course_title: item.title,
                    purchase_date: purchaseDate,
                    expiry_date: expiryDate,
                    razorpay_payment_id: razorpay_payment_id,
                    razorpay_order_id: razorpay_order_id
                });
            }
        }
        
        // 3. Commit Subscription Updates & Log Order History
        await userDocRef.update({
            subscriptions: subscriptions
        });
        
        // Save to Orders collection
        await db.collection(`artifacts/${FIREBASE_APP_ID}/public/data/orders`).doc(razorpay_order_id).set({
            userId,
            userEmail,
            items: orderItems,
            totalAmount: amount, // in paise
            payment_id: razorpay_payment_id,
            purchaseDate: purchaseDate,
            status: 'completed'
        });

        // 4. Clear the user's shopping cart
        await cartDocRef.delete();

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Payment verified, subscriptions activated, and cart cleared.' }),
        };

    } catch (error) {
        console.error("Verification or DB Update Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'Internal server error during payment verification.' }),
        };
    }
};
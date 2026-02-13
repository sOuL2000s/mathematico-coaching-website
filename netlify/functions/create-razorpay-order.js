// File: netlify/functions/create-razorpay-order.js

const Razorpay = require('razorpay');

// Initialization must happen outside the handler for warm starts
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || process.env.VITE_RAZORPAY_KEY_SECRET;

const instance = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
});

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Razorpay keys are missing in environment variables.' }) };
    }

    try {
        const { amount, receipt } = JSON.parse(event.body);

        if (!amount || typeof amount !== 'number' || amount <= 0) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid amount.' }) };
        }

        const options = {
            amount: amount, // amount in the smallest currency unit (paise)
            currency: "INR",
            // Generate a shorter, unique receipt ID if none is provided (using seconds since epoch)
            receipt: receipt || `rcpt_${Math.floor(Date.now() / 1000)}`,
        };

        const order = await instance.orders.create(options);

        return {
            statusCode: 200,
            body: JSON.stringify({ order_id: order.id }),
        };

    } catch (error) {
        console.error("Error creating Razorpay order:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'Failed to create order.' }),
        };
    }
};
// File: netlify/functions/get-config.js

const FIREBASE_CONFIG = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
    measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID
};

const CLOUDINARY_CLOUD_NAME = process.env.VITE_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.VITE_CLOUDINARY_UPLOAD_PRESET;
const WEB3FORMS_ACCESS_KEY = process.env.VITE_WEB3FORMS_ACCESS_KEY;
const RAZORPAY_KEY_ID = process.env.VITE_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;

exports.handler = async () => {
    if (!FIREBASE_CONFIG.apiKey || !WEB3FORMS_ACCESS_KEY || !RAZORPAY_KEY_ID) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Configuration keys are missing from environment variables (FIREBASE, WEB3FORMS, or RAZORPAY_KEY_ID)." }),
        };
    }
    
    return {
        statusCode: 200,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache, no-store, must-revalidate", // Prevent caching of config
        },
        body: JSON.stringify({
            FIREBASE_CONFIG,
            CLOUDINARY_CLOUD_NAME,
            CLOUDINARY_UPLOAD_PRESET,
            WEB3FORMS_ACCESS_KEY,
            RAZORPAY_KEY_ID,
        }),
    };
};
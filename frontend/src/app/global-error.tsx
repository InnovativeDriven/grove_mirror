"use client";

import { useEffect } from "react";

export default function GlobalError({
    error,
}: {
    error: Error & { digest?: string };
}) {
    useEffect(() => {
        console.error("Global error:", error);
    }, [error]);

    return (
        <html lang="en">
            <head>
                <title>Something went wrong – Grove</title>
                <style>{`
                    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600&display=swap');

                    * { margin: 0; padding: 0; box-sizing: border-box; }

                    body {
                        font-family: 'Montserrat', sans-serif;
                        font-weight: 400;
                        background-color: #ffffff;
                        color: #0c0b35;
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }

                    .error-container {
                        text-align: center;
                        max-width: 480px;
                        padding: 2rem;
                    }

                    .error-title {
                        font-family: 'Montserrat', sans-serif;
                        font-size: 1.75rem;
                        font-weight: 600;
                        color: #0c0b35;
                        margin-bottom: 0.75rem;
                    }

                    .error-message {
                        font-size: 0.9375rem;
                        color: #6b6966;
                        line-height: 1.6;
                        margin-bottom: 2rem;
                    }

                    .btn-back {
                        display: inline-flex;
                        align-items: center;
                        gap: 0.5rem;
                        padding: 0.625rem 1.25rem;
                        border-radius: 0.5rem;
                        font-size: 0.875rem;
                        font-weight: 600;
                        font-family: 'Montserrat', sans-serif;
                        cursor: pointer;
                        transition: all 0.15s ease;
                        text-decoration: none;
                        border: none;
                        background-color: #96131D;
                        color: white;
                    }

                    .btn-back:hover {
                        background-color: #7a0f17;
                    }

                    .btn-back:active {
                        transform: scale(0.98);
                    }
                `}</style>
            </head>
            <body>
                <div className="error-container">
                    <h1 className="error-title">Something went wrong</h1>
                    <p className="error-message">
                        We encountered an unexpected error. This has been logged
                        and our team will look into it.
                    </p>
                    <button
                        className="btn-back"
                        onClick={() => window.history.back()}
                    >
                        Back
                    </button>
                </div>
            </body>
        </html>
    );
}

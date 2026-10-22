"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { SiteLogo } from "@/components/site-logo";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
export default function LoginPage() {
    const router = useRouter();
    const { isAuthenticated, authLoading } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            router.replace("/assistant");
        }
    }, [authLoading, isAuthenticated, router]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) throw error;

            router.push("/assistant");
        } catch (error: any) {
            setError(error.message || "An error occurred during login");
        } finally {
            setLoading(false);
        }
    };
    const handleMicrosoftLogin = async () => {
        setLoading(true);
        setError(null);
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "azure",
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
                scopes: "email openid profile",
            },
        });
        if (error) {
            setError(error.message);
            setLoading(false);
        }
        // On success the browser redirects to Microsoft; no further code runs.
    };
    return (
        <div className="min-h-dvh bg-white flex items-start justify-center px-6 pt-44 md:pt-52 pb-10 relative">
            <div className="absolute top-20 md:top-24 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
                <SiteLogo size="lg" asLink />
                <Image
                    src="/innovative-driven-color-logo.png"
                    alt="Innovative Driven"
                    width={176}
                    height={47}
                    className="w-36 md:w-44 h-auto"
                    priority
                />
            </div>
            <div className="w-full max-w-md">
                {/* Login Form */}
                <div className="bg-white border border-gray-200 rounded-2xl p-8 mb-4">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-left text-2xl font-serif">
                            Log In
                        </h2>
                        <div className="bg-gray-100 p-1 rounded-md flex text-xs font-medium">
                            <span className="text-gray-600 px-3 py-1 bg-white rounded-sm shadow-sm">
                                Log in
                            </span>
                            <Link
                                href="/signup"
                                className="px-3 py-1 text-gray-500 hover:text-gray-900"
                            >
                                Sign up
                            </Link>
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        className="w-full mb-4"
                        onClick={handleMicrosoftLogin}
                        disabled={loading}
                    >
                        Sign in with Microsoft
                    </Button>
                    <div className="flex items-center gap-3 mb-4">
                        <div className="flex-1 h-px bg-gray-200" />
                        <span className="text-xs text-gray-500">
                            or continue with email
                        </span>
                        <div className="flex-1 h-px bg-gray-200" />
                    </div>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label
                                htmlFor="email"
                                className="block text-sm font-medium text-gray-700 mb-2"
                            >
                                Email
                            </label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Enter your email"
                                required
                                className="w-full"
                            />
                        </div>

                        <div>
                            <label
                                htmlFor="password"
                                className="block text-sm font-medium text-gray-700 mb-2"
                            >
                                Password
                            </label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter your password"
                                required
                                className="w-full"
                            />
                        </div>

                        {error && (
                            <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
                                {error}
                            </div>
                        )}

                        <Button
                            type="submit"
                            disabled={loading}
                            className="w-full mt-5 bg-[#3A547C] hover:bg-[#2e4463] text-white"
                        >
                            {loading ? "Logging in..." : "Log in"}
                        </Button>
                    </form>
                </div>
                <p className="text-center text-xs text-gray-500 leading-relaxed px-2">
                </p>
            </div>
        </div>
    );
}

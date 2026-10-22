"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
    const router = useRouter();

    useEffect(() => {
        const finalize = async () => {
            const url = new URL(window.location.href);
            const code = url.searchParams.get("code");
            const errorDescription = url.searchParams.get("error_description");

            if (errorDescription) {
                router.replace(
                    `/login?error=${encodeURIComponent(errorDescription)}`,
                );
                return;
            }

            if (!code) {
                router.replace("/login?error=missing_code");
                return;
            }

            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) {
                router.replace(
                    `/login?error=${encodeURIComponent(error.message)}`,
                );
                return;
            }

            router.replace("/assistant");
        };

        finalize();
    }, [router]);

    return (
        <div className="min-h-dvh flex items-center justify-center bg-white">
            <p className="text-sm text-gray-600">Signing you in…</p>
        </div>
    );
}

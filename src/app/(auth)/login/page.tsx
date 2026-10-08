"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { signIn } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const formItemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: 0.15 + i * 0.08,
      duration: 0.35,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  }),
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    await signIn.email(
      { email, password },
      {
        onSuccess: () => {
          router.push("/dashboard");
          router.refresh();
        },
        onError: (ctx) => {
          const msg = ctx?.error?.message;
          if (msg?.includes("verify")) {
            setError("Debes verificar tu correo antes de iniciar sesión.");
          } else {
            setError("Correo o contraseña incorrectos. Intenta de nuevo.");
          }
          setLoading(false);
        },
      }
    );
  };

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="mb-8"
      >
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Iniciar sesión
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ingresa tus credenciales para acceder al sistema
        </p>
      </motion.div>

      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
          >
            <Alert variant="danger">{error}</Alert>
          </motion.div>
        )}

        {/* Email */}
        <motion.div variants={formItemVariants} initial="hidden" animate="visible" custom={0}>
          <label
            htmlFor="email"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Correo electrónico
          </label>
          <div className="relative">
            <Mail
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50"
            />
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 w-full rounded border border-border bg-input-background pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </motion.div>

        {/* Contraseña */}
        <motion.div variants={formItemVariants} initial="hidden" animate="visible" custom={1}>
          <label
            htmlFor="password"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Contraseña
          </label>
          <div className="relative">
            <Lock
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50"
            />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 w-full rounded border border-border bg-input-background pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 transition-colors hover:text-foreground"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </motion.div>

        {/* Botón */}
        <motion.div variants={formItemVariants} initial="hidden" animate="visible" custom={2}>
          <Button
            type="submit"
            className="h-10 w-full rounded text-sm font-semibold"
            disabled={loading}
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            {loading ? "Ingresando..." : "Iniciar sesión"}
          </Button>
        </motion.div>
      </form>

    </div>
  );
}

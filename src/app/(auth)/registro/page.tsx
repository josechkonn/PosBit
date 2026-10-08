"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Eye, EyeOff, Loader2, Lock, Mail, User } from "lucide-react";
import { signUp } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const formItemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: 0.15 + i * 0.07,
      duration: 0.35,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  }),
};

export default function RegistroPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordsMatch = password.length > 0 && password === confirm;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    await signUp.email(
      { name, email, password },
      {
        onSuccess: () => {
          router.push("/login");
        },
        onError: (ctx) => {
          setError(
            ctx.error.status === 422
              ? "Ya existe una cuenta con ese correo."
              : "No se pudo crear la cuenta. Intenta de nuevo."
          );
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
          Crear cuenta
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Empieza a gestionar tu inventario
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

        {/* Nombre */}
        <motion.div variants={formItemVariants} initial="hidden" animate="visible" custom={0}>
          <label
            htmlFor="name"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Nombre completo
          </label>
          <div className="relative">
            <User
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50"
            />
            <input
              id="name"
              type="text"
              required
              autoComplete="name"
              placeholder="Juan García"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 w-full rounded border border-border bg-input-background pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </motion.div>

        {/* Email */}
        <motion.div variants={formItemVariants} initial="hidden" animate="visible" custom={1}>
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
        <motion.div variants={formItemVariants} initial="hidden" animate="visible" custom={2}>
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
              minLength={8}
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres"
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

        {/* Confirmar contraseña */}
        <motion.div variants={formItemVariants} initial="hidden" animate="visible" custom={3}>
          <label
            htmlFor="confirm"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Confirmar contraseña
          </label>
          <div className="relative">
            <Lock
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50"
            />
            <input
              id="confirm"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Repite la contraseña"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={`h-10 w-full rounded border bg-input-background pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 ${
                confirm.length > 0 && !passwordsMatch
                  ? "border-danger focus:border-danger focus:ring-danger/30"
                  : confirm.length > 0 && passwordsMatch
                    ? "border-success focus:border-success focus:ring-success/30"
                    : "border-border focus:border-primary focus:ring-ring"
              }`}
            />
            {confirm.length > 0 && (
              <div
                className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${
                  passwordsMatch ? "text-success" : "text-danger"
                }`}
              >
                {passwordsMatch ? "✓" : "✗"}
              </div>
            )}
          </div>
          {confirm.length > 0 && !passwordsMatch && (
            <p className="mt-1.5 text-xs text-danger">
              Las contraseñas no coinciden
            </p>
          )}
        </motion.div>

        {/* Botón */}
        <motion.div variants={formItemVariants} initial="hidden" animate="visible" custom={4}>
          <Button
            type="submit"
            className="h-10 w-full rounded text-sm font-semibold"
            disabled={loading}
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            {loading ? "Creando cuenta..." : "Crear cuenta"}
          </Button>
        </motion.div>
      </form>

      {/* Divider */}
      <motion.div
        variants={formItemVariants}
        initial="hidden"
        animate="visible"
        custom={5}
        className="my-6 flex items-center gap-3"
      >
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">o</span>
        <div className="h-px flex-1 bg-border" />
      </motion.div>

      {/* Login */}
      <motion.p
        variants={formItemVariants}
        initial="hidden"
        animate="visible"
        custom={6}
        className="text-center text-sm text-muted-foreground"
      >
        ¿Ya tienes cuenta?{" "}
        <Link
          href="/login"
          className="font-semibold text-primary transition-colors hover:text-primary-600"
        >
          Inicia sesión
        </Link>
      </motion.p>
    </div>
  );
}

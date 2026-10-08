"use client";

import { motion } from "framer-motion";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="mb-8 flex items-end justify-between gap-4 border-b border-border/60 pb-5"
    >
      <div>
        <h1 className="text-4xl font-black tracking-tight text-foreground sm:text-5xl">
          {title}
        </h1>
        {subtitle && (
          <motion.p
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="mt-2 text-base text-muted-foreground"
          >
            {subtitle}
          </motion.p>
        )}
      </div>
      {action}
    </motion.div>
  );
}

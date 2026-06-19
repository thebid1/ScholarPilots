'use client';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export default function ScreenHeader({ title, subtitle, action }: ScreenHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-4 safe-top pt-3 pb-2">
      <div>
        <h1 className="text-[28px] font-extrabold leading-none tracking-tight text-primary">{title}</h1>
        {subtitle && <p className="text-sm text-secondary mt-1">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0 pb-0.5">{action}</div>}
    </div>
  );
}

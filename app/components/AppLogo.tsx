'use client';

import Image from 'next/image';

interface AppLogoProps {
  className?: string;
  size?: number;
  priority?: boolean;
}

export default function AppLogo({ className = '', size = 40, priority = false }: AppLogoProps) {
  return (
    <Image
      src="/scholar_crop.png"
      alt="ScholarPilot"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`rounded-xl object-cover ${className}`}
      unoptimized
      priority={priority}
    />
  );
}

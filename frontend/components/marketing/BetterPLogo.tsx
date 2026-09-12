import Image from "next/image";

type BetterPLogoProps = {
  alt?: string;
  className?: string;
  priority?: boolean;
};

export default function BetterPLogo({
  alt = "BetterP",
  className = "h-auto w-[132px] sm:w-[182px] lg:w-[216px]",
  priority = false,
}: BetterPLogoProps) {
  return (
    <>
      <Image
        src="/betterp-logo-horizontal-clear.png"
        alt={alt}
        width={1311}
        height={398}
        className={`theme-logo-light ${className}`}
        priority={priority}
      />
      <Image
        src="/betterp-logo-dark.png"
        alt={alt}
        width={216}
        height={70}
        className={`theme-logo-dark ${className}`}
        priority={priority}
      />
    </>
  );
}

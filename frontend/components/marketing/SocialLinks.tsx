export const BETTERP_FACEBOOK_LINK = "https://www.facebook.com/people/Betterp/61565258835380/";
export const BETTERP_INSTAGRAM_LINK = "https://www.instagram.com/betterp.01/";
export const BETTERP_WHATSAPP_LINK = "https://wa.me/525551087058";

type BetterPSocialLinksProps = {
  className?: string;
  variant?: "light" | "dark";
};

const socialLinks = [
  {
    label: "Facebook",
    href: BETTERP_FACEBOOK_LINK,
    Icon: FacebookIcon,
  },
  {
    label: "Instagram",
    href: BETTERP_INSTAGRAM_LINK,
    Icon: InstagramIcon,
  },
];

const variantClassNames = {
  light:
    "border-sky-200 bg-sky-50 text-sky-700 shadow-sm hover:border-sky-300 hover:bg-sky-100 hover:text-sky-800",
  dark:
    "border-white/10 bg-white/[0.04] text-zinc-300 shadow-[0_10px_28px_rgba(0,0,0,0.16)] hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-100",
};

const whatsAppVariantClassNames = {
  light:
    "border-emerald-200 bg-emerald-50 text-emerald-600 shadow-sm hover:border-emerald-300 hover:bg-emerald-100 hover:text-emerald-700",
  dark:
    "border-emerald-300/25 bg-emerald-300/10 text-emerald-200 shadow-[0_10px_28px_rgba(0,0,0,0.16)] hover:border-emerald-200/50 hover:bg-emerald-300/15 hover:text-emerald-100",
};

function FacebookIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M14.1 8.4h2.2V5h-2.7c-3 0-4.7 1.8-4.7 4.9V12H6v3.4h2.9V22h3.7v-6.6h3l.5-3.4h-3.5v-1.8c0-1 .4-1.8 1.5-1.8Z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none">
      <rect x="4" y="4" width="16" height="16" rx="5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.6" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="16.8" cy="7.2" r="1" fill="currentColor" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor">
      <path d="M12.1 3.2a8.6 8.6 0 0 0-7.3 13.2L3.7 20.7l4.5-1.1a8.5 8.5 0 0 0 3.9.9 8.65 8.65 0 1 0 0-17.3Zm0 15.8a7 7 0 0 1-3.6-1l-.3-.2-2.6.7.7-2.5-.2-.3a7.1 7.1 0 1 1 6 3.3Zm3.9-5.3c-.2-.1-1.3-.7-1.5-.7-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a5.8 5.8 0 0 1-1.7-1 6.4 6.4 0 0 1-1.2-1.5c-.1-.2 0-.4.1-.5l.4-.5.2-.4a.4.4 0 0 0 0-.4l-.7-1.7c-.2-.4-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.8 4.8 0 0 0 1 2.5 10.8 10.8 0 0 0 4.1 3.6c.6.2 1 .4 1.4.5.6.2 1.1.2 1.6.1.5-.1 1.3-.6 1.5-1.1.2-.5.2-1 .1-1.1-.1-.2-.3-.2-.5-.3Z" />
    </svg>
  );
}

export default function BetterPSocialLinks({
  className = "",
  variant = "light",
}: BetterPSocialLinksProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`.trim()} aria-label="Redes sociales BetterP">
      {socialLinks.map(({ label, href, Icon }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={`Abrir ${label} de BetterP`}
          title={label}
          className={`betterp-social-link inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border transition ${variantClassNames[variant]}`}
        >
          <Icon />
        </a>
      ))}
    </div>
  );
}

export function WhatsAppIconLink({
  className = "",
  variant = "light",
}: BetterPSocialLinksProps) {
  return (
    <a
      href={BETTERP_WHATSAPP_LINK}
      target="_blank"
      rel="noreferrer"
    aria-label="Abrir WhatsApp de BetterP"
    title="WhatsApp"
    className={`betterp-whatsapp-link inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border transition ${whatsAppVariantClassNames[variant]} ${className}`.trim()}
  >
      <WhatsAppIcon />
    </a>
  );
}

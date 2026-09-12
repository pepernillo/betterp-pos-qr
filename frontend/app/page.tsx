import { redirect } from "next/navigation";

import { SEGMENT_PATH } from "@/lib/pos-segment";

/** La portada del producto es la pagina del segmento POS QR. */
export default function HomePage() {
  redirect(SEGMENT_PATH);
}

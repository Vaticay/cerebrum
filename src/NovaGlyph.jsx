/* NovaGlyph: Nova's small mark (audit wave step 8, 2026-11-01).
   Below 120px the drop cannot carry her: the glasses wire goes
   under a pixel and the filaments turn to noise, so at small
   sizes she is a flat mark instead of a shrunken character. One
   dark circle, the body, and one horizontal gold bar at the
   height where her glasses bridge sits, off centre the way the
   bridge sits on the drop.

   The values are locked. The body is #23262c, lift 2 of the
   range the owner was shown, picked by him on 2026-11-01 as
   the smallest lift at which the circle reads as a shape on
   every dark ground the app uses; at the first drawn value the
   circle nearly vanished and the bar floated on the ground.
   The bar is the one gold, #c89a3a (REGISTER_GOLD). The source
   asset is ~/workspace/cerebrum-nova-glyph-oct31/nova-glyph.svg;
   this component carries its exact geometry: viewBox 24, circle
   centre 12,12 radius 10.5, bar from x 3.5 to 20.5 at y 10.8,
   stroke width 2, round caps.

   The glyph does not attempt expression. At these sizes her
   state changes are carried by the line of text next to the
   mark and by the gold. Nothing here animates. */

export function NovaGlyph({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10.5" fill="#23262c" />
      <path d="M3.5 10.8 H20.5" stroke="#c89a3a" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

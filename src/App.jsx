import { useState, useEffect, useRef } from "react";
import React from "react";

// ─── Client Supabase ──────────────────────────────────────────────────────────
const SUPA_URL  = "https://dlkijqwatohfggqqosqu.supabase.co";
const SUPA_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsa2lqcXdhdG9oZmdncXFvc3F1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2ODI1OTUsImV4cCI6MjA5MDI1ODU5NX0.bYXW7nobQZZksqty4AdEEMdZW-QYf6D_IglYEBwHv2g";

// Mapping clé-stockage → table Supabase + champ camelCase→snake_case
const TABLE_MAP = {
  admin_ecgs:         "ecgs",
  admin_imagerie:     "imagerie",
  admin_agenda:       "agenda",
  admin_divers:       "divers",
  admin_dilutions:    "dilutions",
  admin_gestes:       "gestes",
  retex_submissions:  "retex",
  admin_contacts:     "contacts",
};

// Requête REST Supabase générique
async function supaFetch(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      "apikey": SUPA_KEY,
      "Authorization": "Bearer " + SUPA_KEY,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "return=representation" : "",
    },
  };
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(SUPA_URL + "/rest/v1" + path, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error("Supabase " + method + " " + path + " → " + res.status + " " + err);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// Conversion snake_case Supabase → camelCase app (champs spécifiques)
function rowToItem(table, row) {
  if (!row) return row;
  const r = { ...row };
  // Champs communs
  if ("image_url"   in r) { r.imageUrl   = r.image_url;   delete r.image_url; }
  if ("image_data"  in r) { r.imageData  = r.image_data;  delete r.image_data; }
  if ("image_url2"  in r) { r.imageUrl2  = r.image_url2;  delete r.image_url2; }
  if ("image_data2" in r) { r.imageData2 = r.image_data2; delete r.image_data2; }
  if ("schema_url"  in r) { r.schemaUrl  = r.schema_url;  delete r.schema_url; }
  if ("schema_data" in r) { r.schemaData = r.schema_data; delete r.schema_data; }
  if ("photo_url"   in r) { r.photoUrl   = r.photo_url;   delete r.photo_url; }
  if ("photo_data"  in r) { r.photoData  = r.photo_data;  delete r.photo_data; }
  if ("credit_photo" in r) { r.creditPhoto = r.credit_photo; delete r.credit_photo; }
  if ("nom_commercial" in r) { r.nomCommercial = r.nom_commercial; delete r.nom_commercial; }
  if ("dilution_standard" in r) { r.dilutionStandard = r.dilution_standard; delete r.dilution_standard; }
  if ("has_second_ecg" in r) { r.hasSecondEcg = r.has_second_ecg; delete r.has_second_ecg; }
  if ("second_title" in r) { r.secondTitle = r.second_title; delete r.second_title; }
  if ("lien_url"    in r) { r.lienUrl    = r.lien_url;    delete r.lien_url; }
  if ("is_pinned"   in r) { r.isPinned   = r.is_pinned;   delete r.is_pinned; }
  // Normalise tags array→string pour compatibilité avec le reste de l'app
  if (Array.isArray(r.tags)) r.tags = r.tags.join(", ");
  return r;
}

// Conversion camelCase app → snake_case Supabase
function itemToRow(table, item) {
  const r = { ...item };
  delete r.id;           // géré par Supabase
  delete r.created_at;
  delete r.updated_at;
  delete r.imageData;    // stocké en Storage, pas en DB
  delete r.imageData2;
  delete r.schemaData;
  delete r.photoData;
  // On retire aussi les données binaires des médias pour l'upsert DB
  if (r.medias) r.medias = (r.medias || []).map(m => ({ url: m.url, name: m.name, isVideo: m.isVideo, credit: m.credit || "" }));

  if ("imageUrl"         in r) { r.image_url          = r.imageUrl;         delete r.imageUrl; }
  if ("imageUrl2"        in r) { r.image_url2         = r.imageUrl2;        delete r.imageUrl2; }
  if ("schemaUrl"        in r) { r.schema_url         = r.schemaUrl;        delete r.schemaUrl; }
  if ("photoUrl"         in r) { r.photo_url          = r.photoUrl;         delete r.photoUrl; }
  if ("creditPhoto"      in r) { r.credit_photo       = r.creditPhoto;      delete r.creditPhoto; }
  if ("nomCommercial"    in r) { r.nom_commercial     = r.nomCommercial;    delete r.nomCommercial; }
  if ("dilutionStandard" in r) { r.dilution_standard  = r.dilutionStandard; delete r.dilutionStandard; }
  if ("hasSecondEcg"     in r) { r.has_second_ecg     = r.hasSecondEcg;     delete r.hasSecondEcg; }
  if ("secondTitle"      in r) { r.second_title       = r.secondTitle;      delete r.secondTitle; }
  if ("lienUrl"          in r) { r.lien_url           = r.lienUrl;          delete r.lienUrl; }
  if ("isPinned"         in r) { r.is_pinned          = r.isPinned;         delete r.isPinned; }
  // tags : string→array pour Supabase
  if (typeof r.tags === "string") r.tags = r.tags ? r.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
  return r;
}

// Upload fichier base64 → Supabase Storage (bucket sau-media)
async function uploadMedia(fileName, base64Data) {
  if (!base64Data || !fileName) return null;
  const [header, data] = base64Data.split(",");
  const mime = (header.match(/:(.*?);/) || [])[1] || "application/octet-stream";
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: mime });
  const path = "uploads/" + Date.now() + "_" + fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const res = await fetch(`${SUPA_URL}/storage/v1/object/sau-media/${path}`, {
    method: "POST",
    headers: { "apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY, "Content-Type": mime },
    body: blob,
  });
  if (!res.ok) throw new Error("Storage upload failed: " + await res.text());
  return `${SUPA_URL}/storage/v1/object/public/sau-media/${path}`;
}

// Compatibilité : safeGet/safeSet utilisés par notifications + favoris restent en localStorage
async function safeGet(key) {
  // Pour les clés liées aux tables Supabase, on passe par l'API
  if (TABLE_MAP[key]) {
    try {
      const rows = await supaFetch("/" + TABLE_MAP[key] + "?order=created_at.asc&limit=1000");
      const items = rows.map(r => rowToItem(TABLE_MAP[key], r));
      return { key, value: JSON.stringify(items) };
    } catch(e) { console.warn("safeGet Supabase", key, e); return null; }
  }
  // Clés locales (notifications, favoris)
  try {
    const val = localStorage.getItem("sau_" + key);
    if (val === null) return null;
    return { key, value: val };
  } catch(e) { return null; }
}

async function safeSet(key, value) {
  // Pour les tables gérées → no-op ici (les écritures passent par addItem/removeItem)
  if (TABLE_MAP[key]) return;
  try { localStorage.setItem("sau_" + key, value); } catch(e) {}
}

const LOGO_HOSP = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QCMRXhpZgAATU0AKgAAAAgABQESAAMAAAABAAEAAAEaAAUAAAABAAAASgEbAAUAAAABAAAAUgEoAAMAAAABAAIAAIdpAAQAAAABAAAAWgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAf//AACgAgAEAAAAAQAAA06gAwAEAAAAAQAAAskAAAAA/+0AOFBob3Rvc2hvcCAzLjAAOEJJTQQEAAAAAAAAOEJJTQQlAAAAAAAQ1B2M2Y8AsgTpgAmY7PhCfv/iAihJQ0NfUFJPRklMRQABAQAAAhhhcHBsBAAAAG1udHJSR0IgWFlaIAfmAAEAAQAAAAAAAGFjc3BBUFBMAAAAAEFQUEwAAAAAAAAAAAAAAAAAAAAAAAD21gABAAAAANMtYXBwbAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACmRlc2MAAAD8AAAAMGNwcnQAAAEsAAAAUHd0cHQAAAF8AAAAFHJYWVoAAAGQAAAAFGdYWVoAAAGkAAAAFGJYWVoAAAG4AAAAFHJUUkMAAAHMAAAAIGNoYWQAAAHsAAAALGJUUkMAAAHMAAAAIGdUUkMAAAHMAAAAIG1sdWMAAAAAAAAAAQAAAAxlblVTAAAAFAAAABwARABpAHMAcABsAGEAeQAgAFAAM21sdWMAAAAAAAAAAQAAAAxlblVTAAAANAAAABwAQwBvAHAAeQByAGkAZwBoAHQAIABBAHAAcABsAGUAIABJAG4AYwAuACwAIAAyADAAMgAyWFlaIAAAAAAAAPbVAAEAAAAA0yxYWVogAAAAAAAAg98AAD2/////u1hZWiAAAAAAAABKvwAAsTcAAAq5WFlaIAAAAAAAACg4AAARCwAAyLlwYXJhAAAAAAADAAAAAmZmAADypwAADVkAABPQAAAKW3NmMzIAAAAAAAEMQgAABd7///MmAAAHkwAA/ZD///ui///9owAAA9wAAMBu/8AAEQgCyQNOAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAQEBAQEBAgEBAgMCAgIDBQMDAwMFBgUFBQUFBgcGBgYGBgYHBwcHBwcHBwgICAgICAoKCgoKCwsLCwsLCwsLC//bAEMBAgICAwMDBQMDBQwIBggMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDP/dAAQANf/aAAwDAQACEQMRAD8A/v4ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACimM+OlIH9aUpASUVGX9KbvamLmRNRVdphGrMegrmdT8a6JpK7ryTbTjFvYUmluzrqK+f8AVv2jvhnoshW+u9u36V53q37cfwF0XP2zUdu3/d/xrpWFrP4YszeLpLeSPsSivz9uv+CkH7NNqxWXVOfqP8az/wDh5Z+zO0m1dV/Uf41vDK8Q9qb+45Xm+HXuuSP0Sor4Jtv+Cin7N9zjy9U6+4/xr0HRv20vghrmPsN/uz9P8aiWXYlb02bRzChPaSPrWivGdJ+OPgHWtv2G53Z+lek2OuWeqKrWhyGrjnCcPjRsqsXszdoqHe1DNuqOZGkdSaiomkG2kWRiM0uYCaim71p1UAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH//Q/v4ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooprNtoAdRUfmf5/yKdvWgCNl21G8sca7pDtWuN8beOdN8F6f9v1Ersr8svj5/wAFUPhP8O/O0G6KCdsqvzelduEy2riZclKNzhxeYUcOuebP1Z1Lxl4X0mMnUL+CHb/ebFfJPxX/AGvPCPge1eax1O3cp/dYGv5d/wBqL/gpVqHjgyx+CdQaDP8AdOa/JHxR+0V8YPEWqO13rEro38NfoOVcA1ai5q7sfIY3i6K0pI/qM+NX/BZDUPBcktrpr+b1X5QDX5y+Lv8AgtV408SXElv5Uqru27ttfiLqniHxFrD+ZqVwZP8Aernpri3tf3kgw1fcYLg3B0F+8jc+WxPEOKq/aP0p8af8FD/F3iyZ5JHlXP4V8v8AjL9oLxJ4oYtJczjd/tGvA9N8vVJhDD1avcvC/wCz34q8bY/s1W+b2r1/7PwFDVxSPN+s16jtds8Zv/E2sXkhka8n5/6aGs+PXNWVt32yf/v4a+6NK/4J4fFzxFGosQ/zf7Ndpa/8Eo/jxeMFVZef9mlLNMupq3MjRYTEy15WfA9j441ezZW+3T/L/tGvoTwb+1B4g8JqjRXMr4/2ia+jJP8Agj7+0NIu4LL/AN+6oTf8EofjxpS7rpZdo/6Z1yTx+W1tHJG31TFR1SZ1vg//AIKh+LvCeGXzX2V9ofCH/guN4u+2JY3UUgCNt+ZBX5b+Jv2B/id4ZV2vEfj/AGK+b/FHwp8QfD9jJNuQr7VyVcmyfEqyszWjmGMou92j+1z4Bf8ABSjT/idcQQ6teRQ+bjdvwK/U7RPih4D1iBJLXVrWVnUfdcd6/wAy3T/jN4+8MyrDpGoPC6/d219wfs+/t0fFHwbeQy+JtYeSNGG7ce1fJZrwBpz4Z/I+jwHF1SDSrI/0Kbe9tbpfMtZVdW9Ks1+BP7Lf/BWD4Z+Jre18N3kqS3KYU7m55r9r/hx8StH+JGk/2tpG3Zx0Nfm+Ny7EYVuNWNj7TB5lh8Sr02ek/M1TVHuRelOVt1eZG/U9IdRRTVbdVAOooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9H+/iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKazbaAEZiKipzSKqlpeBXg/wAXPjRovww037dNcwfdLbWYUU4Sm7QJnUjTV5nqWu+KNC8N2hvtYm8qNPvM1fnr+0Z+3V8M/A+m3P8AY2rL5qIdvOOcfWvxn/bO/wCCui/aLr4f6b958/Og/DrX89fxK+L3ir4iXz3bX9xh3Lbdxr9IyHgiriGqlfRHxObcVQhenRP0u/aG/wCCp3xk8QeJLzRdNmZ7NG+Rt1fl/wCPviZrnxK1I6vrzMZWy3XPWvPWkk27pjvP95uTVjR7HVNY1KOyt7SV9/8AEqk/0r9XwWU4bCRtCKXmfntfF1sQ/eZnstunLN96ug03wH4q15l/sG2aZm/u1+h37Pv/AATp8TfHK4hbZLDlt3zZX+dfvt+zf/wSUXwLDb6lqaLNjH3yDXlZtxZhMGnDmuz0MBkWJxOqWh/L/wDDj9kv45eKNQgVtGdo3b5m9vyr9iPgf/wS1tfFVvA/i6w2b1G7cua/qG+G/wABfBvgqzFvNpdqW27d3lg17db+H9Cs1C2lnFH/ALqivzbMOO69Z2paH2uC4QpQ9+q7n4o/Dv8A4I1/Am3s0u7xEEo/2K+s/B//AATj+D/g1QNPVPl/2cV+iMcMar8gxTtjV8ric9xdb+JUZ9Fh8mwtJe7FHzXoP7MvgzQ8fZQvHtXodr8J9AtW3Kq8e1eo/MtSfeWvNeIqPdnbHD010OLXwTpoXatYOpfCvQNQjImH6V6kq7aGbbU+2mtmXKjTfQ+UfEX7JvgPxNv+2KvPtXzb40/4Jc/BPxgpXUAnz/8ATMV+nvmN/n/9VMrro5jXp6wk0c9TA4aek4H82/xi/wCCPPws02Oa78PwK7r93bHX4t/tH/8ABPv4ieE7h/8AhEdJaaMN/CMcV/fJNY2My7biNH+orlNa8A+EdYtZYbrTbeQuu35owa+my3jPF4d+87o+fxvC9Cqrx0P81C18H/Fr4G6udburB7Yo27d06V+on7KH/BT74oeEdbsfD+qTtFZuQrnd2r+hj9qz/gmrpfxu0ma00m2igL5+5hetfzQ/tMf8E2/FXwFmnNq05+z5+ZCT/Kvu8LnGAzePsqySmfI18vxWXy56ex/X1+zj+1x4B+Kml2iw6ksszINy++K+5bG8t76AXFqdyN3r/Oi/ZX/ay8Vfs0+KjHq01wUE+Nsu8jr71/YP+xv+3RpPxa8O2di00SvJj72Aea+D4i4Xq4J88NYH1+S8QRxC9nV0Z+r7FidtCr/EaghuI7hd0bq4/wBk1br4qMmfVBRRRVAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAf/9L+/iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigBrNtqPd826nv0qPb8vtUykUtrj/M/z/kVXvLuO1h86T7tU77ULSxheW6dUCqW+avyb/be/bq0X4Q+DblvDWqK97Hn90hwa78DgKuJqKlBXZw4rH0sNTc6jPdP2nP22/hn8F9JvtH1ibZeFSqfMBzX8k/7Xn7eHjzx9qF5beF9Q/c7iqck8fnXyZ+0l+1p4y/aO15tY8Sb928n5zmvlZfLjbzGON1ftPD/B1PCpVKqvM/Lc34hq4mTUfhNHVNW1LxLOdU15/NnP8VZkcsLTJaw/fdtq11Wh+FfEnia8Sz0m1ecv6V+xn7D/APwTMm+MM0OqePLD7KyNvXzV9K+qx2Z4bA071XY8PCYOriZ2ij4V+BP7F/xW+KmoRTaXDvhlxt+Umv6Xf2PP+CZvhfQdFhm+IWl77lFHOMfzr9M/2d/2RfC/wV0m1/szZmHH3R6V9vRfcr8az3jGti24U3ZH6ZlPDNOklUras8H8C/s8/DLwHbxf8I/Z+SQvt/hXttraJZw+TCOBV1V206viKtSVR3k7n1kYQgrRViLy2/z/APrp+xadRWXKh8qIdrA8U903U+ijlQyMJ61JRRTAKKKKAGeWv+f/ANdAQDrT6KXKgIWjYjFCruqaimBXaPI5r58+LvwD8C/EbQ7ldYtPNmlr6FaT8KazNupwrTpNTgyJ041VaaP44f8Agoh/wTh1qxaXU/hzY+Xt+duM+/avy4/Z6+O3xA/Z1+KiaP4muvKhtmG5eR0P1r/Qh8feA7Dxrpc1rebfniK/N7iv5Nf+CjX/AATl0/Q2v/iJodsss77vljHPHNfqvDvEdPFU/qmL6n57neSSw0vbUT9zf2J/2yPCPxb8OrN9o8xyg2/NX6eWtzHeWyXMPR/mr/Oz/ZJ/ae+IH7OvjLTPCk0M9tDNOIn5xx/kV/c7+zL8cvD/AMTPA+ktb30c1zJAN6Z5zmvm+K+HHgKnPDWD2Pc4fzlYmPsqm6Prbe1TVXqQP618ZzI+niSUUxWLNT6ZcohRRRQIKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/T/v4ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAprNtpjMwakZg3SlLQCasrVdQj02xe8kI2pS32pQafH5lwdq1+Qn7c37cHg/4b+GdS8PWN9sv2Uqi57iu3A4KpiqqhBXOPGY2nhqbqTZnft6f8FB/DfwJ0ma3kKbnTYvPc8V/G78fvjh4s+MHj668RLqEps5+iZ461H8bPj546+NHiK8/4SqbzbfzTs5J4zxXh37q1T0Wv3vhrhylgKfO177PyLOM5qYup5DAqopavRvhH8Idc+NGtf2Lo4cPv2/LXVfBn4F+PPi14lsP+EdtvOtXcb256V/Xd+wz/AME+vB/guwsNa1mz2TyKHf5e9acQcSUsBTaT98nKcpqYypZbHzH+wn/wTH1LRI7PxR4itmniTG7zBX9GfhX4b+DfCljDb6Lp0VsUQK3ljHauh8NeGtN8K6eum6YuIq6Jl3V+EZnm1bG1HUmz9ay/LKOFilFFVY1VdqrhasRrtFOVQvSnV5vMz0fQKKKKkAooooAKKKKACiiigAooooAKKKKACiiigCFl202rFN2LS5ULl7Ecnv0rxH4z/CfSPiR4WfR5rVJGfPavb360mxqunN05qUSakFONmfw4/wDBSb9kHUPhr8RBq+jwtbpbTlvkHpmvRv8Aglv+1pfeC/iB/YfiC8aWO2nCKsp9hX9OH7W37N/hH4peAdZ1a+h8y8WAsnGea/hO+NXg74lfs2fEzV9YtYfIt/tBZG5HHFfr+SY2ObYOWGq/GlofmebYWWBxSqw2Z/oj/Dfxxa+PvD661Zldpx92vQK/DX/gmD+1Rpvir4V2uj61c5vJNvy59q/cSGRZIUkX+NQ351+W5lg3ha0qUz9Ay7FKvRVRFpF/iqSmp92nVwHoyCiiigkKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP//U/v4ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiim71pcyAjf71VZJFjUyMdqirzfMvFfK37Qvx50H4TeHb2PUiok8htu445IrenTdSSpxW5lWqKnF1JM8J/bw/ak0j4JfDt9X0u8jedFZmRTk8V/D9+1J8ftY+O3jpvEl3LKFYk4ye9fRX7aX7WHiD4n+NtS0OO+Z7TcdqZr835G+XzJO1fu3CPDqwVL2tRe+z8jz7NniqtlsiTeuP9qvavgL8Fte+NHjiPwr9ll8mTHz445rnfhT8Jde+MGsQ2Ph/d8soVtoz3r+xD9gH9h3SPBvhWw8QazYKZxjc7D0r0OI8/p5fS0fvnNlGU1MZVt0Oi/wCCf/7AOk/Bvw+n2qJHdUH3ua/aDSdPg0uxis4UVViXb8opmm6RY6WghsU2KtbHlt/n/wDXX8/5hj6uMqurVep+vYPAU8LTVOmhE+9U1NVdtOriidgUUUUwCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAifrSj5k205l3VDSkVzMp6rpyalps2nyciRdtfza/8Fif2UILzwO2qaTbK7yRF/kHPU1/S9Xz/APHX4V6b8UNDbT9Qt/tACEbTXr5Jj5YPExqrY8vNsEsTh3Dqfw5/sN/GjWPhb8dNL8D3ReGP+JW9iK/u4+G/jC08WaDZzW0yyboFZtvPYV/Cn+1d8L7z4K/tQf8ACSWKfZ4IN3bHcV/Sd/wSj/aCX4vaD5LTeYYYivXP3eK+04twccTSjjKW1tT5HhvGPD1Xh6jP2uRv4akqNGXbup33l4r81P0AdRTFUin0AFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH/1f7+KKKKACiiigAooooAKKKKACiiigAooooAKKKKACmv92nUUARh/WhsMu4U1/vVDJJHGu6Q4pSFKR578UvHGn+B/Cc2uXUvlpH/ABV/IH/wVE/bc1DxFrD6b4TuvPQuEbafwNfpt/wUo/bct9B8N6l8ObWVRI+drL14461/Hbr2rah4i1S4ur6Z5t8rH5znvX6rwXw+ptV6p+ccTZy23RjsUb+7k1m+fWLn/WSfMa6bwT4V1Lxd4ig0W1i3mZtu2uTbzo49sKNI3oozX76/8E0f2F7z4oS2HxKvIWUW+H2vx19jX6Tm2aU8BhnNnx+Awc8TVUIH2n/wTF/YTg0SeHV/E9p5Ik+dWYV/SV4Y8O2fhfSU0mx/1SVk+BvCum+F/DtjptnbpE0ESoxUY6V3DNur+dM0zWrjaznJn7LlmXxwtJQW45WUCpKhVd1TV5p6sgooooJCiiigAooooAKKKKACiiigAoopMrQAtFFFABRRRQAUUUUAFFFFABTdq53U6igAqNkG1vepKhkYD8KAP5wf+CpH7M9rdeFdT8eQw5kTPzY9cmvzj/4I6/Gu4+G2qXOl6hL5O+eRFXP+2a/qb/bO+H8Pj74H6joYiUvL+fQ1/FlrGg6h+y18VLOxZmi8+/C/99PX6jw/UjjcvqYWT16H51ndN4TGRqpaH97XgPWv+Eg8L22rKc+Yu6uy+b3r5l/ZI8TR+Ivgbomob1JdPWvpz7/4V+a4ml7OpKD7n39CoqlJTQR96kpiJtp9YGsQooooGFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAf/W/v4ooooAKKKKACiiigAooooAKKKKACiiigAooooAjfd+FK27bzT6Y/SgCKvj/wDa4+PWi/A/wv8A2vq8nlqYieuK+nPFmtR+H/Dl5q0j48iPdX8kv/BWr9rj/hPtGn8J2dz5xt0MW1TXu8P5XLG4iMLaHjZ3mSwlF66n5K/tp/G7VPil8Wp9U02432j7vl+pr47VcttH3mpI7xrpfOm4rr/A3hbVfFniaws9LgadJZ1Vtvpmv6Nw9Gnh6KhtZH4xWqTq1HNn2p+wT+zbqHxU+JyWmsQ+dbOyfLiv7gP2YfgToPwj8IjR7G28ldoGPpXwr/wTz/Y30HwH4P0rx4ERLuVQzLjniv2a+Va/CuLs6eKrunB6I/VOGspVCl7WS1Yioq9KXYtOor4o+sCiiigAooooAKKKKACiimv92gBvmf5/yKb5melRv92oGmjt/mkOKWi3Icn9kvq26nVxuoeOfCekqW1C/ih/3q831r9oz4OaTC/2nX7dGX3NXCjVn8CJlXp01eTPc23fjSV+Xfxg/b68E+FLV5NC1uKUrn7hr8mPjB/wWY8ceGZ5YtBuZZVGduxv/r17mC4fxeJ0pxPLxOf4Whuz+oXXvFul+HU8zUDjA9a8H8RftafDXw2WW/f7v+0K/jr8cf8ABa343eKGe3m+0Efd+8P8a+XfE/7dHxc8eMzSW877/cf419VheAMS/wCL+Z4Ffi+P2Ef2oa1/wUk+AuhqWvJen/TQf4V5Hqn/AAV//ZlsGMck3I/6aj/Cv4mNe8ZfFTxSW8zT7h9/+fWvHtS+FfxM1ZjN/Y9x8/tXvUeAMKlerP8AE8qpxZipu0UrH95Gm/8ABXz9mXUJBFHNyf8ApqP8K+n/AIZftp/Cf4p4/wCEdkzv/wBoH+lf5ylp4F8XeGv9KvrCWHZ/eFfWX7PP7ZHjb4OeJLDTdJEvlvOqNtOOCfrWOP8AD6lyOeHd/maYbi6spWqo/wBG7T9Qj1K1S+tvuPWkrbhmvgX9jn4/L8TPhzpUl1cbppF+ZSea++mbbX5Li6MsPVdOR+g4avCtTVSIM22nVBu+b3qVPu1hE6ug6on61LUbj+IUSIlHQ5fxPo8OuaO+n3Ayr1/H7/wWR+EdxoPxc0e50GLYBews3HuK/smr8Xf+CkHwFT4leJLbVGi83yXjfp6V9Lw1j/q2KU+h4ef4X2uG03PRP+CefizUH+GejaLdS52IF21+sD/er8c/2L7OXw/rVv4fxgQsFr9jWZg1cGd29u2up1ZTf2CTE2NUo6Ck3rTq8o9WQUUUUEhRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH/1/7+KKKKACiiigAooooAKKKKACiiigAooooAKKKhY/N9KCojlX+I1JUKttrlPGHiix8LaSdU1J9kQohFzfIROdk2z4I/bi/aS034Y+C9Z8PyOollgMY55zX8F/xe8cat40+JmsXF1cvLFLcFlVjmv2Z/4LFftHalrHxM/s/wpPvtnnKtz2wa/CZv30xv5v8AWycmv3vgvKPq2GVVrVn5BxFj/rFdpbIhlh3p9nj4P+zX7xf8Eh/2W2+Kko1S8tvO8lmf5h6Gvyb/AGafhrffEL4vWGizRb7eb735iv7rv2Hf2cdF+CHh2FtMh8rzYA3TH3hWXHGdrDUfYx3Zrw5lrxFVTeyPtL4e+F4fB3hO10GNNnkLtrulXdT/AC1/z/8Arp9fhUpc7uz9aprkVkFFFFIYUUUUAFNVt1BZc7TUNLmQ+aJMzbab5n+f8io6p3t7b6dbm8um2olMnmXU1Kgd41X5iBXyv8SP2vvg/wDDaGT/AISK98ohT6f41+LX7U3/AAVA8P2tjPH4D1LdJzt+b/CvVwGTYnFP3YnmYzN6GH3Z+8fxG+Mei/D+0muLx0PlKW+Y1+Snx+/4K/eAfh2s1uyQZjyvU/41/Mb8Vv8Agoh8dPF18bX7ZuSRtrfMa+b9Q0P4tfG1vLtY/tEkv1r9Fy3gSnTSqYt6Hx2N4rqVPcoqx+yHxk/4KyWvj61mXQ5/JL5xsJr8mfid+098T/E108ljrF0gJ3fKa9m+Cv8AwT3+PGvaxbyahpbfZm+82DX7pfA//glp4ZvYYW8XWGDtG75a96VfJ8t+BXPGhRx2Nep/LzoOsfFjx1qH2NtTvHz/AF/4DX1R4H/Yf+KXxKZAbi4fzf71f2JeAf8AgmD+z3oNvHdLaYm/i+UV9ReGf2Tfhd4VZW02HGz7vArw8Xx9Si7UI2PWwvCVaetVn8i/gv8A4Ih/FjxIEuQ8/PzdB/8AE19ufDf/AIIp+MvD5ik1SKWXb/eAr+ozR/C2l6JGI7NduK6RV218vi+NsdVej0PeocK4WDvI/CXwr/wS8h0nZ9qsFbH94V9BaX/wT98L2sKrNpMRI9q/Vqmv92vEq55iqm8j045NhobRP5y/2rv+Cawm8H3mqaTZeTj7uwV/LP8AFz4M6l8FfFQ/tQN+7n3c/Wv9J7xnodv4k0GXS7oZV6/jh/4LRfBGTwr4mjuNBh2gupbivvOC8/q1MQqFZ6M+T4lyanSh7Wkj3n/gkz+0sviLxpZ+DWm/1LKu3PrX9ZKyrMpZa/zj/wBi34vSfBH4kJrV3L5Oxl3fhX9kv7Mf/BQD4TeKPDSLrWo5ndR3FcHGeRVaeJ9rSV0zr4XzSPs/ZSdj9T6sV5n4P+KXhHx1hvD83mZr0jzP8/5FfnM4OE/fR9rTmpL3GDKSab8y06NtwpzLuoNr/ZG+Z/n/ACK8t8feBLXxdC6zRq7Fflr1Py1/z/8Arpdi04ScHdGVSCmrM+Mfhn8A9Q8HeNH15srGSGWvsx1/ip2xadWlaq6jvMzo0VTVkV6mT7tJ5a/5/wD10+sjolIKKKKCQooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//Q/v4ooooAKKKKACiiigAooooAKKKKACiiigApjKWan1E/WiUgGSfu1zX50/8ABRr4rW/w/wDgZPqVrMvmpu+VTz0r9DdQmWOwuJv7iM35Cv5Kv+CpP7UUeqx6h8P45/mG/wCXPrxXu8PYJ4nFRVjxc9xfscK7Pc/Af4ufFK++LWttql8zEq5bmvHbppo1Hkhj/u1R0+TyVdpK+jf2efhzN8WvEn9j2Kb2DhfWv6NlOOFo3lokfjMVOpUt3P3F/wCCYf7I66zJp3xGuIfmTb9735r+uTSrOOz022t4wF2RqvHsK+Dv+Cfvwl0/wJ8G4bG6gAmXb834V+ghj+UKO1fztxHmUsZi5tvRM/ZMiwCw1Bd2DdBTk6UrLuGKFXbXzqVj3B1FFNf7tMB1FQ72qTd8u6p5gjqRv96qtxeWtmu64kVMf3q5Dx94407wD4fm8Ral/qovvc1+KH7Tn/BV74Z+G4LvS7WREm2mNfm716eCyytjJclGNzz8VmFHDJuoz9Yvil8evBvgTSzdf2pb+Yufl3Cv5/8A9rP/AILHat4H1K48K6G3nRvldyAEcV+HP7RX7bnxC8ea1dXOj6s6W0jHaqmvlHw9oPjD4xapFZzTNPc3H3WxX6jlPBNChH2uKZ8DmXEtWu+Sjoj6I+PX7Y3jH9oSZ13TjLfdXI/lXzb4N+G/j7xp4gFv9jvJEfHzYJFfrt+yn/wSr+J2qXUOpavC8scjb/mXtX9JH7Pv7BPw78F6Vb/29o6NOmNzMK9HGcUYHAR9lQje3Y5cLkeJxcuafU/nT/Zp/wCCUM3xcih1TXImgPDbXyK/c79n7/glV4Z+E5h1A+U54b5jn+dfrT4f+Gfg3wrH5Og2S24/2a7lYRGu1egr84zXizF4u65rI+1wHDVDDq8ldnnXgj4b6D4O0pdPitITt/i2j/Cu9itLWP7kaJ9BV7b8u2o9jV8rObnq2fQQgqatFDdqr92m7fm3VIsf4VIqhelZcvcrlRG/3qkT7tDLup1WMKa/3adTWXcMUARqu6vy1/b+/ZMs/jtpd1qkiKXhi3Kv0FfqX5bf5/8A11n3ulWWpQvb3ib0ddrLXTg8VUw9RVY7o5sVho4ik4T6n+bN+0R8AvG3gXxtf6bZ6bceVC3ysinFcL8P/iR42+GrpcSC4h8v+Fs1/oMfF/8AY/8AhP43s3mj0aIzvnLV+Gf7Tn/BKXXte+03XhGxaFOdu1a/Xcs40oYmKo4hH5xjeGsRh250tT84/gL/AMFgvGnwnuYbWJJXUMEbjPtX9FH7K/8AwUg034zWtsdcvEtzLjd5mB1r+Rn4s/sBfE/4L3U15ryvs3Fl3Livnvwv8WviF8M/EX2XT9ReARY+Va9DMOG8BmNL2mGtc5MJm+JwtS1S9j/TU0XxNoOtQ+bpd1FOMfwHNdAsua/kb/YP/wCCpGl+CtNg0H4hXn2meZQis7Y5r+kz4K/tIeFfi5Z2x0XbmRR905r8kzPI6+Cm1UhofomW51RxUdHqfT1FR+Z/n/IqSvDjI9cKKKKYBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAf/9H+/iiiigAooooAKKKKACiiigAooooAKKKKACmv92nVDJ8vzUpBKR89/Hj4kWvgXw7dNcTeVmBv1Ff5/wD+3D8QLzxR8etUkU74W+62fc1/VV/wWB+ODfC/w8qwy482IL8vvX8aPj7Wv+Ew8Sza/JyZK/YeAMtsvbSW5+Z8XY/mq+xT2ONt7X7T/o8XLvX7i/8ABGf4FXniD4uNNr1vstzcLtb2wK/FzwHZfbviBpem7c+dOFr+4j/gnL+z/b+BND0rxMIQjToH3Yr6TjXMvq+FcF9o8jh/BPEV0+iP1o8I+GbXwppo0yx+4tddUO9qmr+fZSbd2fsUI2VkFFFFSMKrs7basVHL9ylIqJRkuFhjM0jbVX71fJP7RX7S/gz4UaL9svL8QsELV698aPHVr4J+H+r6zLKqNbQF9rGv4af29f21tW+NviLU/BenzywrauYtyEr/AJ619Vw5w/UzGp5I+czvN44SNo7s+iP2wv8AgqJ8Ste1q58L+HrlpNNfPzb/AMK/HPWtU8VfFrUvOWNppZH3evOah+GPgnXviV4qt/CmyeZp/wCPBP61/R9+xn/wSVvla21rUhnpLtdvxr9drYnAZNRVkuY/OcPRxOPq7tn5R/sw/sJ+PviJr0S+IdKKWbsPmYZr+mj9mP8A4Jb/AAt8M2cOtX0Sx3MOGX93X6f/AAo+CXhj4e+HbbSRYW/mQr8zbRmvdobe3hTbbKqD2FflWdcWVsZJ+zdkff5Xw5Sw656urOC8F/D3SfBdrFa6b0jXatehK22nKpBpzLur46Um3du59LCCSsh1FNVdtOoLCiiigAooooAKKKKACiiigAooooAhLN0qreW63lubeToauCP1pr/eoFK1j5L+MP7JfgP4u2sseuqvzL/dzX4D/tlf8EsfDWh6Pc674JtfOueduFxX9VRHrWJq2gaVrFuYby2SZT/eANe5l2e18HJOE9DyMwymjiYv3dT/ADRPG3wh8efCbxBFJrFk1vLC+5a+0P2e/wBvz4nfC+4htbGRgIcL97Ff03/tof8ABN+x+OE1zrmkwRQbMv8AJha/l8/aq/Yi8Sfs7tNqccU8q8t8mW/lX6bhs5wmZ0lGtufnWKy3E4CXOtu5/T9+yX/wUG8K+O9Et4fFeqbLyXHysc1+ufhnxt4d8WW6TaHP5wK54r/NP+Hvjjxd4H8SQ65591CsX8GXH6V/Q7+xX/wVGXw+9roeqvlpMRfOM+3evj854YlSvUo6o+kybiNtqlWP6vlPzfWpq8q+F/xE034heE7XX7eaItcruwpH8q9Rj718O007M+4jNSV0SUUUUhhRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQB/9L+/iiiigAooooAKKKKACiiigAooooAKKKKACuX8YapHovh+41GQ4Ea11FeCftK6wdF+Dmsaipx5cda4eHPUUDKtLkptn8qf/BaP4sR+NIRY2MuTHtXr6Gv56rVmS3DSda+3P2uvilJ4+8WahZyPvWOdl6+hr4dvmaG0+Wv6SyDCfV8JGmfiGZ4n21acz61/Zg+EOteOfiVomqWKboYrgM3GeK/0Ff2efC1r4f+E+gwqm2VLUbvzNfy5/8ABG74P2/jjw9Frlwm4woG+Ye4r+uLwtp66XoFrp69I021+WceZhKrX9j/ACn3/CGC5Kbqvqbm35ttTUny7velr87PtQooooAKazKo+akd9teH/Hv4jL8NvBEniLzPK25+b6VpRpOpJQXUmpP2cXJn4of8FWv2oP8AhWt9eeEY7jy/tJMW3Nfx/wDiS3vPFni681Kx5e5l3fnX6Nf8FQPjf/wub4kf2ss3nYnLdfrXlH7AfwZb40ePv7HuId6iUL6+lfvuQYanluX+1nvY/HcyxNTF4ppdz94P+CZn7FPh/VvCdj421qx3zDb8+PXmv6T/AAv4U0XwxZxWukxeVhAv6V4T+yb8OY/hr8M4/D8abFG39BX1F5f+f8mvxrO8zli8TKc3ofp2UYCGGopJajV5bNTVCjfNtqavBiexIKKKKokKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigCtcW8dzCYJRlX6183fFf9mH4W/E6zMPiOw87K7e3+FfTVFa0q0qbvBkVqMasOSSufx6/tyf8E99Q8H3134m8L2fk6fHn+Cvwp/4qDwz4gSTSX8preb+Rr/Qa/bhsY734A6lG3f/AANfwpePNJj03XrtY+88n86/QMmzirVouNTU+HzLI6UJXhofvP8A8Er/ANpDxl4q8VWvg/VrzzYo2Uba/qKXb/DX8ZP/AASLs7pfjoJGRgu+Ov7NPufjXymeU0q+h9RlTfskmSUUUV4p6YUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAf/9P+/iiiigAooooAKKKKACiiigAooooAKKa/3aho94UpE25c7a/PP9vD4rWWhfBXXNF+UO8Rr9CFPzfWv5zf+Co3xObS21LQ/Nxv3Ltr28kw3tsXCHmeVnVd0sK2fyK+KtQur7x5q00zsVa6kb9adoOiyeJdRXSYfvH+7WN4gZv+EgvLhf45Wb9a+gf2TdA/4Sr4rQaXjezbfl/Gv6Sr3pYdyXRH4rGPPUP6yv8Agif8MpPBfwxkjvk3Mbcfe+or96Y08v5V6V8DfsKeAm8D+DjayJszEB/Kvvpvn6V/NOdYqWIxVSq+p+2ZRhlQw0Iobsapqh3tU1eQenGQU1m206mtt/ipSGQyybI2k9BX40/8FTfjlb6X8D7vSbORUmTzPunnpX7Ba1eR2Ol3M0jfciZv0r+LH/gpj+0V/bHjLUvA/n5UZ+XPrX03C2XyxWLjZaI+d4ixvsKDV9Wfh7Dq2o+PNehtLqVpnml27mr+nL/gjt+zLdeEPG0PibV4WeKeVZF3DtxX86PwJ8B6hrnxM0eOzTMb3A3V/f5+x78I9P8ABvw90TUootkrwBm496/SeOczWGwyoU+p8Xwzgvb1+d7I+4rW1t7OPybdFRf7oqwzbajDN0qRtv8AFX4hLU/Vo2HUUUUwCm7vm206oZGWgAf71SM22q7thSzV4z8Tvj18PfhPY/bvGFz5KY3dqqNOU3yRV2ROtBK89D2eS6ij+8y/nXnXib4jWPh26S3k2newH51+PvxA/bE1Lxv4u/s/4b3PmpLnbz/hX2V+zXoHjrxNB9s+JEfzbSy9fw616M8ulSp88zzYZkqtTkpfefeWk6iup2SXafdetSsuwtY7OEW8P3BWpXmHqhRRRQAUUUUAFFFFABRRRQAUUUUAFNZttOprLuoA+QP23ZvJ+AupH/PQ1/Dh4ug/tjxRMI/4rhv/AEOv7iP24sf8KD1P/PY1/ETNCzeKpmH/AD9N/wChmvocqrOnF2PJxtFTnqfsx/wS18D/ANl/EaHUNn3mWv6o36V/NV/wTTmj/wCE0t4+4Za/pUkP8NeXmVVyqXO3Cq0bBH3qSo4+9SVxHREKKKKBhRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH//U/v4ooooAKKKKACiiigAooooAKKKKACq796mf7tRp96gLXKvmCP5jX8bP/BYP4hNZ/FybSVf77yV/YR4s1KPSbHzjxX8H/wDwV+8QTal+0Q3lv8vmyV91wJhvaYu58fxbiWqSpn5c3kSzSyzepLV9vf8ABNHRZNW/aXtLWROPl/nXxDC25U96/Yn/AIJZ/DeVfjhZ65s4bb/Ov2HPsX7DCVG+qPzvLaTqYmC8z+2/wL4bh8O6akMaqPkHSu2+Zajtk2wp/uirVfzPUnzu7P3KiuSKRGnzfPUlFFQUNZttQt83Wpn+7WfeXSWdubiToKV9bBKOh8a/td/HOH4R+HZ/MmWLzYT973FfwNftbeKG8ZfGzUfESy71l9/c1/SL/wAFyPi9eafosVvo1x5bbFVttfyw6LourfEbXvs8bs80v8Vft/AeXfV8M8Q+p+UcUYv2tfkXQ/Z7/gl9+zzH8SJLPxNJFv8As+Hr+0L4f6Wuh+DNN0tVx9ngC1+Iv/BGH4HzeCfhu66/DmTyBt3D3FfvRHGsMYiXhRX55xdjfrGMkr6Jn13DOFdLDKTWrJlXdUjLupsfepK+TifUhSZWlqvJ8nSqjECxVWTy4/mkbFM8z5S3pXyZ+0t+0l4d+DPg2XWtUKgR5+8cdK1w+HlXqKEFdmdevCjTdSpoi1+0F+0N4e+FPhnULqS9ijnhjLKjHkmv5Tfj1+2Z44/bA8V3/wAO7OG4MVtKYFZBjIPPb614N+2l+2X4m/aQ+Klrpfw/1Boba8uNjIhzkEGv17/4JjfsC6p4Z1a08ffEC1a5iv2E+5xjjpX6RRy2jlWG9viVeo9j8/r4+rmVb2VJ+6e+fsI/sIrp+j2njjVmYTR7fllJz+tfulZ2cNjbx28SKvlKF+UegqHQfDuk+HLH+z9JhWGIdlraCetfn+PxtTE1HOZ9xgsFTw9NRgInWpaQADpS1wnYFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAfHf7bkbTfAXUlX/PBr+KPUrdrHXrqRhtxO7frX9zf7TnhubxR8KL7SbcZd/8DX8cn7Rvwn1L4c65N9uVhvlPbHU10Qxfs1YPYKo7n3J/wTD8aLJ8Vksbh9gV161/VhHNDdLut3V19q/hv/Zd+KkPwl8Zf29ePsG4Nu+lf1k/ssfHXTfih4RXULd92VHf1rCddVHzI0dFw0Ps35lqReVqGP8AeRq696m2/LtpC0HUVCrbamoJlEKKKKBBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAf/1f7+KKKKACiiigAooooAKKKKACiiigAqFl21NTVbdUyHGR4X8ctSk07w35y+hr+Df/gpzeTap8dDcN/fav7oP2ob0WPgvzPY1/B9/wAFBtW+1fGAvjPztX6l4eU/37fkfBcYt2R8VxfNPCvqy/zr+mH/AIJd+FY01qw1Irz8tfzMxyZu7bPd1/nX9dn/AATD8Isug6bqmOuK+040fJgUfK8OQviEf0ix/cH+7U9Mj+4KfX89n7MFFN3rQrbqCuVgy7q8f+OviL/hFvhlqWtKdphTdXsVfln/AMFAPj7b+F/hbrPhjeod0K+9d2AoOvXjFdzix2J9hRnM/lJ/4KEftAXHxg1y60uWbzfs8pj656Gvn/8AYJ8IyeLvjtbaPMmYjt/nXzB4q1641jx1qDXDs4mum+97mv3K/wCCXP7Ntx/wsyx8cSI2w7fp1r9+xs6eW5a6a7H4/h1LFYpX6s/q/wD2dPhpa/Drw/8AY7Vdm5AvSvpCo7WCOGELGNvyjpVgJ61/O9aq6lRyZ+yUqfs6aghqttqao/L/AM/5NSVmbjX+7Vdtv8VWGbbXK+Kteh8O6LNq8zKBCu75qqKvoKW3Mzz/AOLfxS8N/DfRZ7jWbnyCIGZfyr+Kf9v39tLx98SvHmoeAdHkaaw52/N68V+kH/BV79sZrm1Ol6Pc7WVQjeUf8K/DP9mPwDqXx2+NSW90jyedt+Zge59a/UeF8pjhqLxdZH5vxBmUsRW9hSeh95f8E0f2J1+J01n4w8RWm2S3xKvGea/s3+GvhW38J+DdP0e24W3iC18q/sX/ALPNj8E/Cv8AZskCZaIDoPavuf5VXaq7Vr4/iDOKmNxDd9FsfVZHlUMLRT6ssJ92nU1Pu06vnD3wooooAKKKKACiiigAooooAKKKKACiiigAooooAy9X0u31azNpc/dNflb+15+yDoHjq3uL63h810XcvHev1jfpWddWNvfQvDcRK+Rj5hRKN0VF21P4cvil8DPFHgvxJdQ3lq0dojcNX0b+zT+1D4k+FuqWnh21lZLU4VufSv6DP2hP2N7H4tabLa2cKRO+fmXANfgD8ev2ONY+EOqvbwiU+Xn5lJPSvIxTnS1R62GlGroz+ib4K/tTeCfFGnWy6hfrvZBuHvX19pfibSdYjWbT5d6tX8UfgH4geJPh9qGLi5nCxP8AxE1+tH7P/wDwUGW1kh0G63Fhj5mFKhmkXpLQK2WSSvA/oS27vmoTd+FeGfCX4xaX8RtN+2GaJPl3bcgV7dHcQTcROp+hr1IThPVM8qSa0ZZoopqtuq+ZEDqKbu+bbTfM/wA/5FMI6klFNZttOoAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//9b+/iiiqN3qFnZrm6cIP9qgC9RWAviTRW+7crU/9v6P/wA91/P/AOtTsxc8f5jYorH/ALf0f/nuv5//AFqP7f0f/nuv5/8A1qeoXRsUVj/2/o//AD3X8/8A61H9v6P/AM91/P8A+tRqF0bFFY/9v6P/AM91/P8A+tUX/CSaJ/z8pSsw54/zGu/3qbWQ3ibQVX5rlBVT/hK/Da9bxBScJ32JlNfzHy9+2bdfZfh75nT5Wr+Ev9taSO8+JzTNy29q/uB/ba8X+HJfhyY47pCdrV/DT+11cQ3XxEMlsd67zX634dxl7Rn55xjO8krnybK2NStV/wCmq/zr+3P/AIJi2Nv/AMKt0qbHPH8hX8Rcq7tStf8Arqn86/tq/wCCavirwnpPwj0v+0L5ImGPvfQV73H7f1KK8zy+FrfWT91VO1dtFebTfGD4Zw/67WIB+NZF58ffg9Yrm5163T8TX4YqNS+iZ+qOtHqz2L5venKv8Rr5t1T9qj4I2kJaPxFa5+pr5x8d/t1fDnRY3/s3XYH2/wB010QwFeb0g/uMJ5jQh9s/Ra+vorGPzJulfx7/APBW/wDaAax+I1z4Zt58JI7LjNfWH7SX/BV3VfDeky/8I5etOwzt2PX8zv7R3xu1X9oTxo3i7Xi3nFifnOTzX6Fwhw1WVf2tZaHxfEee06lP2VNnz/cW82oeJIZrf/lpcL+pr+6j/gmT8IbWz+DWla/JD+9OPm/AV/JP+yT8A7j4teIoI2g3iKcN0z0Nf3nfseeC18D/AAXsNBC7PL/h/AV6PH+ZJRVKLOXhLBupVdRn1Qn3adRRX48fpYUUUUAQs26vyn/bt/aj8P8Aw/8ABeqeGRNsvCpVee4r9Bvip46s/AOh/wBqXU3krz830r+K/wD4KZfH648XfFaW30+XzonduVNfScPZU8VWV9j57iDMPq9K0d2fnP8AE7xr40+K3jiddSuPOjkutqL7Zr+mr/gmn+xzDpul6f48urT5jj5selfin+w7+z/J8ZvEqTXUG/E+7kehzX9vn7NPglfAfwrs9BVdnlfw/gK+u4szRUaSw9LofM8OZb7er7aoe6WtnBZxiO3GPlq1RQvzdK/LFd6s/RuVEkfepKaq7adVyGFFFFSAUUUUAFFFFABRRRQAUUUmVoAWiiigAopMrS0AFIAB0paKAGsu6vAvi18FvCfjbRbiW7tvMuG+6a953tS+Y3+f/wBVZzgpqzNIyad0fzL/ALTP7G/iTTZ5rrQ7fYu7d93tXwA/h3VvA98Y5vknT+Kv7LvG3gex8X25hutvK7ea/Nn48fsI+Fbqxm8Q2aI9w+flUc/+g18vmeU1HrRPosBmsV7tU/HX4Z/tG+PPCd9BHHeYhVhuX2/Ov2T+A/7ZXhm6jhh1y43uuFb5q/GL4mfs++LfC995en6a5iDfMyjtXneix3/hO48ySJkdW+YV8r/a2KwMrVD6F5ZQxsb0z+uHwx8YPC/ioD+z2zn3r1XPy5Xoa/l9+GP7U3ibwhdRQ2+/avvX6ifCH9sWbxMsS61c+X/D8xr6fL+KMPXX7x2Z81jeH69F6LQ/T5PvU2vNfDvxO8I6xZoy38Rdveu0i8RaIy/u7lTX0lOvTqK8WeG6VSDs0bnytTqxV13R1/5brQ+vaOR/r1ro54dyOR9jYVt1OrFXXtI+6sy1O2saaq5aUYo9tD+YOR9jTorJ/tzSv+ey/wCfxo/tzSv+ey/5/Gq9vDuh8k+xrUVi/wBvaP8A89lp39v6P/z3X8//AK1R7Wn/ADIOSfY2KKx/7e0r/nsKd/bmlf8APZf8/jV+3h3Qck+xrUVj/wBvaV/z2FH9v6P/AM91/P8A+tUe1p/zIOSfY2KKx/7f0f8A57r+f/1qP7f0f/nuv5//AFqPa0/5kHJPsbFFYn/CR6P/AM91o/4SPR/+e60e1p/zIOSfY26KzI9X02b7koNaCyKy7hVKaezIlFrcfRRRVCCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/1/79JD2r5/8AjddXlvo+61dkbb/DX0Eyq3Wud1rw/p+uQ+TfDK1dOajL3jGvBzWh+T+v/GPUPC7M1xMzbK+fvGX7fVn4PU/aGY4+tfsVqn7PvgHWMi7i3Z9q8p179hv4K+Id3263zu/2RXvUcbhf+XsWeNWwGK+xI/CrxF/wWN8P6DI0cgU7frXnk3/BcnwrCdrRL+tft3qv/BLX9mfVmLXNnlj/ANMxXlusf8Ei/wBmhifJst3/AGzFe7Qx2Ste/BnlTwWaJ/Gj8j/+H53hD+4P/Hv/AIqj/h+d4Q/uD/x7/wCKr9Gtc/4JF/AVf+PWw/8AIYrkbj/gkd8FfL/d2H/jgraGLyR/ZZm6GZ/zHwfJ/wAFz/CO0qET9ap2v/BbjwzfSFVC/rX1h4i/4JJ/DNWP2TT/APx0V5/L/wAEovCVvIzW+n/+O13U6uSL7LOedLMu54zef8FovD/knaq/rXC3H/BZHSb5t0bL+te6ah/wSv01pP3en8f7lcbqn/BK2ONs2mm/+OV2c+SX0iccoZn1Z8o/GD/gqHZ/EjQf7Ht3+bn171+Tvj7xT/wmWsf2k3PzFq/Zz4tf8E19U8MaH9us7Da+09q/HH4reDbr4eeIP7H1BNj7itfW8OvB3awp89msa9/3x5vs/fJJ/cYN+Vfod8L/ANs6++H3heHQ4bhk8r+6a/PqFlMiR+rBa/QP4H/si+KfiZBDeWdpvSX2r1s2+rKmnidjjwLrc37rc1/EP/BQDxVfMfs+oyj/AHTXz944/a++JGuwtHZ6vdJu/umv1k0D/gl54glZGvNN+9/s17xof/BLHTWCfbNO/wDHK+QeZ5TSd4xPoPqGPqaM/mc1L44fGC8m3Lrd6R9f/sax/wDhZfxU1BvLm1W8fd8vWv7AfBf/AASn+G8kyf2pYf8Ajor678L/APBJ39nVVSS8sfmH+yKmrxtgKeiiOPDmLmfxUfD74W/ET4nXS28tzcSb/wC97/hX6AfDH/gkr8TPH80V9C84Q+w/+Jr+tzwr/wAE8/gL4SYTaZbYK/7Ir6c8L/CXwr4RhWPSU2qPavnMZx9UaaoKyPbw3CGqdVn4/wD7B/8AwTZ1b4AXKX/iSFpM/N84r9udC0yHSbFbGFNij+GtO3Xyl2L2qb+P8a/Psbj6uKqc1V6n2GEwVPCx5KZIq7adSAg9KWuM7QqjeXC29u9w3RF3VYf71ef/ABG8Uaf4f8J6jcXL7SluzfpTim3YTmkm2fkH/wAFRv2jrfw/8MZbOwmWKVEb5lPNfx3yeIr74sfEC2t5XMzzN/FX6Qft0fHy88eeOtV8KedvhRiu3PrXz7+yP8F5tc+LmjytDmHf81fqmUwWBwntGfmmYOWOxXKj+iD/AIJNfs5r4Hki1TVoN4mUv849RX9BFvb29rH9nt12D2rxf4J/DfQvBfg7TH01Njm3XPHtXuXy7vevzrMsY8TWc2ffZbg1hqKpkbRsRihV3VNRXDzM7goooqQCiiigAooooAKay7qdSEgdaUgIlbbQzbqG2/w1VuLmO1ieWboi7moiEp9iwz+tN3Bu9fF/x1/aK8O6Hpr2ei3P+kpndzXmvwv+KXjLWNPXxFfPutYsFzmsHWTlyI2dB25z9FLq7jtbd5pCo2KT83tX5+/Fr9vTwn8ML6axvBEWj9a+S/25P2xrjRdJSz+Hl3mbYA/Pfv0r8T/EnjbxZ49un1DXm3+b97vXlYzNVS0gepgsqdRc8z+lr4R/t9+Evik0S2IiXzP7tfoPo98mpafDqEfSZd1fxmfBfxdq3hT4haRpemnETzhWr+wH4UXUl58OdIuZfvSQhv1royzHvELUxzPBrDtWPR6KKK9U8say7qZ5bf5//XUtFBXMxrNtqpc2VrfR+XcoHT0NW2XdTqCTyzxb8K/B+vaPc2rafE0sqYVsc5r8mvih/wAE/wDxBrOpXN5pwdEkYsoUV+3FUpoY5V2yV5GY5NRxkXzLU9HBZlVwzvBn8s3j79nfW/h27x3G/cntXiVrrGvaXNttZpYsNX9Uvij4G+C/Fkhk1OLOfavk/wCJH7Hfgpctott830r8xzPgvE025UWfb4DimjP3KyPyB+H3xu8SeG7xZLy8lKL/AAsa+q9L/bMjtYfLmly1aOv/ALI+rR3T/ZLT5fpXmeofsn+Mlm/c2vy/SvmvZ53hfciz2HUyrEazPV4f2z4JvuvVn/hsiH+9Xicf7KvjyPpafpXRaB+yz4ya+H2y1+T6VxVcVxHf3Xp6GkaGUW1/M9Oh/bGhjkDb/u10U/7bVi9uIlxuFZP/AAynqX/Pp+lH/DKepf8APp+lc7xfEk+/3EcmUdvxJP8Ahs6H1ob9sy37nNRr+yjqG75rb9K7zw7+ybC0f+mW36VMP9ZJ9WE/7Fh0PPW/bGiduTTv+Gw4/wC9/n8q9oi/ZJ0rPzQfpXUaf+yP4Z2/vrf9K6Y5dxI/tHPPGZMvss+co/2yI1+8as/8Nmw19UW/7Ivg3+K3/StS1/ZH8Cs/7yD5fpXoQyTie2kjllmWTfys+Qx+2As3zLTv+GuPp+X/ANevtyP9kn4dovyw/oK0LT9kv4ceZ+8h/QVf+rvE0n/ERhLNsnW0WfDNv+1g1xJ5e6uhX9oya4xtc/NX3HD+yb8MYzuEPzfQVsQ/sz/DtOFh/SvSw3CnEX/L2qjmqZ1lX/LuDPiqz+Ml5dKrLK3Na8XxN1Bvm856+2YPgH4Ft1+WLH4VfX4KeC1+6n6V7OH4Sza37yaOGecYTpA+a/AfxCury4CyOx+avtbw7cG60tJK5PT/AIWeF9OO63T9K76ztY7NVt4fuivtMjyzE4NP6xK54GPxNKr/AA0Xo+9SUg6Clr6WMtDzQooopgFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQB//Q/v3PQ1Eo+b6VNRQBBt+b3p3lt/n/APXUtFLlQEKfepzoG5qSimBAIoz95RSbF/uVYopRiypFZre3P3owfwphtbM/8sU/IVcop+8TGJR+x2f/ADxT8hTWsbPP+pT/AL5FXgqrzRsWlKWoSifOP7Qej2d14Vwtun3T/CK/g+/4KSWa6b8bDEE2fO3tX+gl4/0Rtc0trZRniv4Mf+Ct/h9tD/aEa3YY/eyfzr9N8PatsS1fofCcYw91M/NKFttxbN/tr/Ov64f+CYniC1uNF03T5IkPT7wFfyNK22SFj2cV/TF/wS58WRya1Yabn5vlr7bjWlz4Q+X4dlbEI/rIXT9PVRtgi/75FTR2dmP+WKfkKni+4uf7tTAAdK/n3mkfslolT7Pbq/yov5VN8v8ACtTUhAPWgRFuZvlptTgAdKWlyoJRK9FT4WlpSjcSViOPvUlFFUXIiZVXlulflR/wUG+OEfw70u60tZtnnRbPzFfpp4u1iLQtHfUpvupX8of/AAV4+ME3iLXkj0ebYodVbbXoZfR9pVR5+PqclPY/FP4lW0mtfEy/8RRsz+c+7rmv6HP+Cav7Ndv4o0O18ZTIoeNVb5vevwn+DPg2++IXiL7GvzuWH61/Zp/wTx+HP/CEfC5bG8iw4Ra+nznHyVBUrnhZVgI+09rA+/tHtfsWk21l/wA8kA/KtRPvUFVX5VoT71fD81z6qOhNRTWbbTqYwooooAKKKKACiiigAprLup1RydqAKtxcQ2sfnXLqiD+Jq+B/2pP2orT4Z2s2n6XcLK0i7eOeore/ab/aG0nwf4Vu9NjdUuB/Fmv5zfHnxK8SfFTxVFbLdtKHuNv615ePxvs/cjuelgMDz+/LY+rfg7Nq/wC0R8XLnT9QDrDK4+Zsgc1+i/iyPVvhT4Zn+G+m27yxTLt3KM9Peq/7Gv7PV14Zt7Pxdcw4MuG3Y9K/SrVPBXh3V5/tGoWyuf7xrLB4eTjdl4mvHntDZH85t1+yTf8Aj+8udQvkl+di/wAxP1r5N+Inwv1jwLcvp5s3EMX8WOK/rgt/AfhO1XENqo3V8OftvfDPwXY/CubVrOzVJ/m+b8K8zNss9nSc0zuy/Mm6qiz+b74Y6etx8TNHk9LgfyNf2HfCJdvw30Yf9O4/nX8oPwK8A6nr3jjTNRtt2xJw1f1mfDK1az8A6Vbt1SAL+tYcLSlOLbOniSKTVj0Ciiivsz5MKKKKACiiigAqLy2/z/8ArqWigCHY1Rsqt94Zq1RS5ULlRRNpaN96NB+AqM2NmeDCn5CtDYtOqZQT3L5jP/s6z/54x/8AfIpfsVmvzLCn5Cr9FT9Xh2Fzy/mKX2e3/wCeS/l/9ahbe12/6pPyFW/lWo3+9Q4Loh6lb7Pb5/1afkKescI/gX8qkorTS2xMZNibIf7gp22Fey0lFS7dBRkxef7q0vlq3zbak2rndTqrlRTlci8tv8//AK6ZVim7FphyxIakj707YtOoEQs26m1NsWjYtLlRUpIjZdtCruqaihq5IUUUUwCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/0f7+KKKKACiiigAooooAKKKKACiiigBCcDNRb2qao/L/AM/5NKUQI2TPymv4sf8AgsZ8M7i++NE2uRxZCSyNur+1IJg5Nfzo/wDBUL4arq39pa00Wdm75q+q4SxPscWpXPnOI8N7TCs/kCmhQTtH/wA8z/Kv1j/4Jb/E68t/j3Z6LI+2Mbe/vX5R6pb+Tr15D/dlZa+vv+CfepNof7Q1tfM+FG3+dftedqNfCzXkfl+Bm6WIjPzP9Fmwu4bq3Rojn5RWjXhXwR8VL4o0JbhTn5BXttfzfVhyNo/cKM1OKZYopqtup1ZlhRRRQAUUUUAFFFNf7tAHy5+1l4uj8OfCG/vIX2yJ/ga/jC+OXjKb4na5cf2o25lnbb36Gv6Wv29Pi3HaeDb/AMO7+WzX8pNvHNqPiz7O24+ddH9Xr3srfIm2jzcelP3D9Bv+Cafwlt/EHxgFvqCYhZ128V/YR4O8H6f4P0/7Bp/3K/Df/gnj8CW8O6hZ+Kcf63a1fvxXnY3EurK7OrDUVTjZDWUN1oVQvSnUVxHQNZQ3WnUUUAFFFFABRRRQAUUVG7fw0ASVyviXxZofha0N1rM3kptzW9cTra27zN/DX5X/APBQD4qSaX4R22c2xhEfuH61zYquqVJ1Gb0KLq1FBH5X/tpfF7UNe+Jk2l6S/mWr7uc+9dR+xj8CbXx1eRalcxbij7+noa+N7Vrjxv4nRZN0jv8AnX9AX/BPr4d/8IrpW66h6ofvD1r43AzeNxN1sfWY1LDUOTqfol8PtDj8P+ErXS1GBGtdp5a01Au3y1GBUirtr7iK5FY+OlJ3K9wreU7L/dNflb+2x4s1y98H3OjgZQbq/U+8kEdnNJ6IW/Svxe/aF+IMPiTxJc+EYxll/uj1rweI6/Jhrdz1cno81a/Y8Z/Yf+Gl1q1rDqUkP3MGv328N2v2PQ7a1/uJtr4g/Ym8Fx+HfCrpNDhvK/iFfeqr5fyrRw3Q5cNGT6lZziPaYhroWKTK1EzbqbX0J43NoWKKjMi45OKjMkO7O8fnSlICxRTPMT1pjNuo5kBJvWlBB6VBTvmWjmRWhNRUfmf5/wAild9tHMiR9FVTIq/MzKKaZom/jX86OZFaFyiq/mK/3WzQznb9KZJNtVvmqGnK22m7t3PWlLQPtHG+OfFmk+C/D8uu6zN5MMX3mr5G0b9sr4V67qAs9N1VZH37Pxzimf8ABRCa6h/Zt1VrOVo3/vKcHoa/jh/Zb1LxRcfERFm1C4YfbT96Qn+OvrcoyKnisLKtKWqPlc2zirh68KMVoz+/Lw/q1vrmkw6panekq/K1bVeJfs8NIfhDpJmfc/l/eJr22vkq0PZycD6WE7xUycdBS1H5n+f8inFvl3ChbGo6iq9ODKv3mxRzICQsq8UoIPSoGdD91gKcrbaOZFaE1FN3fLupvmf5/wAimHKySioGmhX7zAfjQs0bfcYGlzIknoooojIAooopgFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQB/9L+/iiiigAooooAKKKKACiiigAooooAQ9DTI+9SUUFczCvzO/by+GMmvfC3WtUjTLBC1fpjXif7QWi/298KdV0zG7zI+ldmDrOlWjPzOLG4dVaM4M/zbfHWh3Wj+MtTjuBjbcSfzrtP2fdck8K/ESLWCdgGP519Sft1fCGT4c+Iry+8ny/OnLfma+H9Pa4sbMahbjc9fu1HHrEYd+aPxypQdOpy9j+8b/gm98RF8d+BDdb9/wC4Dfyr9PP3dfzN/wDBGv4xXVn4FFjfv5TSRAbWPuK/pS026+16bDdD5t67q/FM4o+yxMktj9XyTEe0w0L7mpuXO2nVCq7qmryD1wooooAKKKKACo5jiMmpK8U+MfjxvA2k/bFfZ8hNAH813/BQz4kXUfxKudC8z5G3fL+NfmL4B8Nzax4usZIl+9cK3619AftqeKG8UfFqbUmOc7v510H7JPgmfxRrdrcxxb9kob8jXoRrqmrXMvYt6n9PX7Jfgb+x/h1pd0yYO2vtpW3V5R8FdPbTvhvp1mw2lFr1dV21w9TfoOoooqSQooooAKKKKACiiigAquzruqxUO1d9TIDk/HN9/Z3hG/vhx5cRav5mf2qPirN4y1i90MS58pym2v2G/a4+OeoeB7S88O27sEnUx9a/nX8USLfeKrzUz1mlzX57xZmzT9jFn2/DOW3vVmet/st+A7jVPihYtdpmE/e/MV/VD4J8IaP4Z0m3/smPZuiXd+Vfjb+x38LbW4a18QY5GK/cWzj8uyih9EA/SvW4VwrjR531PL4ixKqVeRdB/OaduY02oZpVt4zLJwq/xV9XLufNyujivGvi/S/DemzC+b5niKrz6ivxc8LeF9S8V/tJTahdfPZvjt7mvqD9uT4lX2jrb2/h/dNvaNW2e5r1n9m34V2d/wCH7bxreAJcvjdu6+tfCZlV+v4xUIbRdz6jCxWFwzqS3lofYPh3wzpfhu1+zaWmwY210lN2LTs45r7qiowgoI+Zcm22xzLtrzTxz8UPDvgG3kuNabCxru64rX+IXiiHwh4Zm1qZ/LWPvX8pf/BTL/goN4q03Xv+Ec8GyvdpcuIG2H14r3MmyipjqyhE8jNMyjhad+p+wXxM/wCCsH7PPhK6m0u4nxND8rfvR/hXzPL/AMFjPgKdSTF38n/XUV+AXwf/AGO/Ff7S2uLr3ijTHSG8YNvcZ61972//AARN8Dtpr3TQRbx/sn/CvuK2SZNhmqdWTufJ0c1zHEJySP2S8B/8FaP2d/ETRWsVxudvl/1g/wAK/Rj4f/F/wv8AEbS4tW0NsxSfd5zX8Svxw/YF174A/wCn+C9Me4MLB/3Qx05r3j9hL/goR8SvDPxUtvhV4oSeztIdv+sPHXHrXFi+GaFek6uCd0jqw2f1qVT2WJR/aVRXm/w98eaX4409bzS7hbhdu75a9G+8tfns4tXT3PuITTSa6nK+JPGGk+F9PfUtQ4RK+JfiJ/wUb+Bfw5keHWpcMvy/6wD+leGf8FB/jhrXw/8AhvqU2n7vkzt2n2NfyYeE7zxd+1prNx9stnnxOy+vQmvtMi4ahiaTrVn7qPks2z2rQqeypLU/qM8X/wDBYr9nWPMdpc4I/wCmo/wryuL/AILFfA/7Wv8ApXH/AF0Ffkv4N/4JM6f4rhS81KxUNJ13LXfat/wRn8M2di9xbWiF1+78te68ryWHuSkzyo47MJrnsft58L/+Cr3wB8TTJarPuYtt/wBYP8K/TTwH8UPD/wAQtHi1jQzujl+7zmv4G/jR+yX4y/ZzuUvvC+lSv5TB9yDHev0a/wCCcP8AwUQ+IUnxEs/hH4m82C3j2/fPTJxXHmfClJ0XXwTukdGC4lq06vssSj+xL5Vr53+PH7SHgT9nzRxrXjV9kTJv6gcV7fo+sWOtW4uLGVZQy/w1+en/AAUN/Zxsf2gvBaaPeIsiiIp8wz3NfC4CjSnWjCs9Op9bi69RUHKlufn3+2d/wU6+BHxK+EN/4R0GbM833f3gPY+1fzn/AAF+K3h3wX4uXVNWOIvtRl64435r7e+P3/BNHS/hr4NufFlvbKGh9q/LHwH8Nf8AhMNcXSSm5TL5X64r9ryPBYD6pKNKT5Op+U5licV7dOqtT+uz4W/8Fd/2b/Cfw7sNDvLjE0KbW/ej/wCJr79+Cf7cHwp+MlrFN4blz5uNvzA9a/mA8M/8EkfD/ijwjbeIGtkZ7hd33K/Xz9i/9i2y+DdpbW9vbhFjx2x0r4fOcFlcKbdGTc7n12W4vHNr2i0P3ctbhbm3S6Xo67hXCeLviZ4f8GWRvNWbai++K6u3DWPh8Rj/AJZQfyFfzo/8FGf2qPFng3S76xtQ+xN33TXyWWZbLGYj2UD6HMMesLR9ofp140/4KTfAPwPMYdWlwy/9NAP6V86+LP8AgsV+zXbxtHbXGCP+mo/+Jr+W34b+FfGX7VTDU5LKW5U/MzdetfZfhf8A4JL6f4qRJtTs1Rn+Zty195LhrLsNeOKk7+R8ms8x2I1prQ/fz4N/8FIvhH8VvEsGh6HPukm+7+8Br9V7WZbi1juF6OgYfjX86P7KX/BMfwz8J/Gln4itYUDw/wCzX9FFqFsNIRW+UQxBfyFfGZ1Rw1Oajh3dH0+UVK84t1xuqaxa6Pb+befdr4d+Lf8AwUC+CvwlunsPEMuJUz/y0A/pXzH/AMFJP2xrr4J/DuW+8N3O+4RW+VDg8V/Klca58XP2xfGEGoahptxcW9w3zP1HNezkHC7xVP21V2geXnPEf1ep7Glqz+mHxh/wWP8A2ffNMdjdbcNt/wBaP8K0vCP/AAWM/Z5kmC3Vzn/tqP8ACvyX+H//AARp8L+KLGLUNWtkR5U3tle5rifjB/wSJ03wDor6p4bsxNMM/LGvP8q9v+y8llLk5nc82ePzGEfaWP6o/g7+2r8KPjVbrdeFXyrr/eB/pX2BZ3kd5bpcx/dddwr/AD5vhn8cvi5+yH4207wpHYXFtC84ifoBgfjX9eP7E/7Vcfxo0bT9PubrfN5YVlzkg189n/DTwn72jrBns5NnzxHuVtJn6Yru3c1JTVbdTq+QifTBRRRTAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/0/7+KKKKACiiigAooooAKKKKACiiigAooooAKwdesF1bTZbGRdwet6oWHzfWgfLdWP5X/wDgsz8AZFsUvNPh2Z2n5R71/PbbaH/ZNr9huk3MK/u0/ba+CcfxW0GRWh8zyovTPQV/Gr+0H4FuPCfxKutDjTHlfw/jX6BkWa3o+xkfEZrkyVb2sOp9CfsW/tA2fw18TaV4bVlTz5Qm2v7YPhVq8et/DvSNSVgfOgDfrX+eP4Lt7zRPHWm6o3y+TOGr+w79gH9oKPx5pun+F/tG9rdRFtzXiZ9C7TR62Trkufrkn3adUPzLU1fNH0MohRRRQIKKKKACvzb/AOCiHjD/AIRPwILpXx+4P9a/RbUpvs1lLcf3Vr8J/wDgqH40m1Dwc1jbvlkiK/qaic7K5pRhd2P5+fiprEniPxGdQznOa/ZL/glH8O4/FVo11JFu2bm+b2r8k/Auhw+INcit74ZzX9NH/BOHwLp/hPR2+xpjchrnoz9o7nXXjyKx+o2g6cul6ZHYgY2Ctio246d6crbq6zht9odRRRQIKKKKACiiigAooooAK5nxHrEeg2Jvpui101eJ/HTVrfR/Br3VycBc/wAqxxNT2dJzZpRhzyUT8Tf28PiIuu+K/wDRTgNKfu/jX5yw6TNqlx+73bi1fR/7RXiCz8Ra99otWyu81P8As3+C18YeIPsbJvw4WvwHM8b9axns092fr+Awyw+D530R+zv7GfgWS3+HsF4w+7t/lX6Axp5cYU9q8b+CGgL4c8Hpp4GNuK9ikYD8K/dcqp+zwsY+R+U42fPWlIa0g3V5X8VvFUPhvwbeXxbDRLXomoala6bH5l0cCvzT+Nfj7UNb8aJ4ZsX3W1wxDLXFxBmCwtD3d3oa5ZhHXqe90PGPANxJ+0d4mnsV/e+ROV/75Nfrd8O/DP8AwifhmLR2G3ZXz5+zz8HdL8Cyf2taxbHuPnbj1r6+2LXncNZdKFL20/jZ05rilKXs4fAgXDLUTKVqVV21G27+KvrIni/3T4P/AOCgHjKTwz+z3qt5bv5bp3X6Gv4t/hD4F1z9pb4kR31xK9ykN+Wbdzwr1/V1/wAFNNauB8DdWs8/Jz/I1/M3/wAE8fi58N/hr4guZvGk3k4uJG7f3zX6rwzQdPL6lekrzPznP6iqYuNOo9D+yr9lv4L+C/CPwh0i3bTIBOifNJjmvqFfDuhbcC2TFfl54D/4Ka/sw6P4XttPm1XDIvqP8a67/h6V+y3/ANBb9R/8VXxNfLMdUqOTps+rw2ZYWnTUE0fZvxA+E3gnxNot1HeaZBK3kv8AeHtX8U/7ZfwZvPgv8bNQ8d6SjWkK/d8vjoSa/qFvP+Con7Ls1rLH/a33kK9R6f71fz7/APBRr9o74H/ErwxeSeFbrzZ5d23pX1HC1PGYet7OpF8j0PnOIHhsRFVIPVH7Af8ABGn4xT/FP4Yy3l9OZmW3H3j7iv26X7u+v5Sv+CFXii80/wCHptYThXgC/qK/qn0mZp9NhlbqVr5zifDqlj6kYbXPocgrOpho85+C/wDwVOIHwx1cfX+Rr8tf+CIvh3RNavr/APtS2Sf97N97/fNfqT/wVP8A+SY6v+P8jX5n/wDBDH/j+v8A/rrN/wChGvrctdsmqW7nzeMj/wAKKP65fCngrwnFosLQ2EQ49K6RvCPht12tZxEfSpvDP/IFh+lb1fmlSb53qfeQguVaHxv+0P8As7+C/G/h28k/sqBmS3ZunoK/icaxb4Y/tvX1rYf6OkbLhV4/jNf3++MP+RY1H/r1l/8AQDX8DHxo/wCT6NU/3k/9Dav0LgutKUasJvSx8PxTBQqxnBa3P7K/2JfGFx4u8Hm4uJWkbyg3zfhX2xdafZ337q8jWVf9qvzo/wCCdf8AyIbf9cB/Sv0jT71fD5nFQryUT6/L5Xoxufnz/wAFDfDeg2/7N+qyQ2qB/wC9j2Nfx3/ss2dpN8QAsyKf9Nb/ANDr+yz/AIKIf8m1at/n+E1/G7+yt/yUUf8AX6//AKEa+74Xk/7Pqep8ZxFFfXYn9wf7PnhXw7L8JdKZ7ND8npXucOhaTZ/8eluifSvLv2eP+STaV/1zr2p+lfn2Jk/aS9T7zDxXs1p0M29A/s+dR/zyb+VfyUf8FWlX+zdQb/er+ty//wCPGb/rk38q/kl/4Ktf8g7UP+B19Lwj/vSPn+JP4B7f/wAEEfDfhXWvhPNNrVjFcyfZx8zjnqK/pNs/BfhSGIeTYRJ+Ffzg/wDBAL/kkk3/AF7D/wBDFf0y23+pFLiy6x9TXqXw7BfVloZsWi6Ta/NbwIjVj+Nb7+z/AAbqV4Pl8m3dvyFdey7q81+LTND8ONcZf+fOT+VfLUot1FE92o1Gm2fxO/t3/F6++MHjzVfh7azsfJcptHvX7of8Ejf2cfCel/BlLjxDpsU9yqR/O45r+X/xl4q0/Sf2uPEE3iR8W4uBX9Nn7G/7fn7OPw1+H/8AZOpah5b7VXqO341+sZ7hq1LBQo0IvWz0PzXKqtKeKdWuz9y7Twl4bs4VitrONAoxwKi1DwX4T1KHyb6wikX0YV+fn/D0f9l3/oLfqP8A4qj/AIej/su/9Bb9R/8AFV+d/wBk47fkZ9z/AGrhbWuj80P+CpX7IGn6zq114x8M2a2iWbGX90K+Cf8AgkD8YtS8O/Hy/wDDepXLSpaXgTDH2Ffqp+1d+3x+zf4+8B6zY6bqHmTXEBVOQefzr+e/9gfXvsP7SGsa1pp/dz3+9G9sCv0PLKOIq5bUpYlbLS58Ti50YY6M6L3Z/fX4X1qPXdNW+j+61dLXz9+zrqU2qeAormQ5JxX0DX5RWhyVGj9Hou8EwooorM0CiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//U/v4ooooAKKKKACiiigAooooAKKKKACiiigApjvtp9RsvO4UCkZmp2cd5p88UgU74mXp6iv5VP27/ANmP+y/F1/48WHGc/N9Dmv6vsqy7Wr4h/bO+C9l8QvhfPY6ZB/pL7vmUc9K3wmJ9lPQyr0VNWZ/EXdTNJNux91q/TT/gnP8AGWT4a+Omu7mbYPPDfMfYV8pfGL4K6x8I9W/s3WlbcXK/MMV5ho+uah4fuBcaXK0R3bvlr2a1eNSF2cdOg4OyP7zPhb40j8d+G01qN94bH616lX5D/sBftJ6Pc/D+28L6k6vdPt5zz0r9b4plkiRv74B/OvClHXQ9JX+0Sh8nBqSoVXdU1Z6lSCms22nU1l3DFMInNeLLjyfDd5L/AHI6/mc/by8XtqC3VrnOzK1/SR8TLxbHwFqt038EBNfyJ/tKfESz8SeMNU0tTkpKRXnZlX9nTsj08uoe0qHj/wAAbSTXPiNaaft+/wD41/WX+y34J/4RXR4TsxmIfqK/mc/Y98MrcfGLTpmXKf8A1xX9f/hjTbXT9HtRbJs/cp/KsMqm5ptm2awUGkjpWXdQq7aN606vXieIFFFFMAooooAKKKKAGs22hW3Ublb5aPurQA2R9lfFX7Y3iBbf4ZzRxvz838q+zriQLbyN6Ka/Hb9sD4jJcWdzoav8wzXy3FmM+r4Rtux7mQ4V18VE/HHVL6S+m3NuPzV+hv8AwTz0NtQ8dkTJx5o+99BX5+aPbNdalFC38bba/aD9hnwK2i63FqDJt3sGr8Q4Wg8VmMeyZ+q8QzWHwM4d0fq9p9kun2/lLV6RlxubotOZd1ef+MvFlrodnLayffddq/jX9G1q9OhSvN2SPxOFOdSdkeR/tFeOP7D8LltLfzJQp+WPrXz/APBv4Ut8RJIfGmqLsli52v71paH4b1rxd4ymbVHaa0dhtRq+2vCfh2z8N2P2Ozi8oV8Xg6dTM8V7aa/do92tWWDpckPjfU6bTbOOzs47Rf8AlmoX8q1Krx/J1qxX3sFZciPnpSCon61LVeiQ4n4z/wDBTS3m/wCFM6s2Gx/9Y1/Hv8Av2ff+Fx65cwrM0W6eRepHc1/cV/wUV8Dtr37Peqrbp85/wNfx3/sx+NtN+A3xAXT/ABQATNesvzcdXr9c4RxThl81S+O5+a8SUV9bi6mx9kaB/wAEgrvWNLi1BbuX95/tvWv/AMObrz/n7m/7+NX9Sf7Nd54L8afC/S9QitkPmpX0c3gnwz1NstfPV+McdTm4OR7VHhqhUgpI/jPvP+CO+oQ/duZ/+/j1my/8Ee7i5j8uZ5XX/aYmv7OG8B+F5PvWq1RvfB/gyxh8ySzSphxri31KlwvRSuz8f/8Agnf+xbD8A/DaacoxhAv61+22m2/2Wwjt/wC4u2ub8P2ui+Vu0uFUH+zXXKu1M181mWPniqjqT3PbwGDWHp8sNj8CP+Cp/wDyTHV/x/ka/M//AIIY/wDH9f8A/XWb/wBCNfph/wAFT/8AkmOr/j/I1+Z//BDH/j+v/wDrrN/6Ea++y3/kS1fU+Rxf/IyR/Yf4Z/5AsP0rerB8M/8AIFh+lbj/AHa/Mp9T7+lsjlfGP/Itah/17S/+gGv4GfjQuf25tT/3h/6Ga/vk8Yf8ixqP/XrL/wCgGv4GPjR/yfRqn+8n/obV9/wTL+L6Hw3Fvxw9T+uv/gnSMeA2/wCuA/pX6TbVX71fm1/wTr/5ENv+uA/pX6Rv96vjs3j/ALTI+ry7/doHwf8A8FFm2fs06qf89DX8bv7J8ufiEP8Ar9b/ANDr+yL/AIKLKz/sz6qv+ehr+M/9le6Wz+IiLJ3vT/6HX33CsV/ZlXvc+I4ik/r8O1j+7b9nc4+EulH/AGK9qLblrwz9nKTzPhBpTL/cr3GvzfE/xZep+gUf4cfQr3//AB4zf9cm/lX8kv8AwVa/5B2of8Dr+tq//wCPGb/rk38q/kl/4Ktf8g7UP+B19Pwj/vSPA4k/gHv3/BAL/kkk3/XsP/QxX9Mtt/qRX8zX/BAL/kkk3/XsP/QxX9Mtt/qRRxb/AL/L1NOG/wDdUStwteZ/Fxmb4b65j/nzk/lXpj/drifiBa/bPBOq2o6y2sg/Svl6ErSTPcrK9No/zn/jd4Nk8ZftReINPl3RAz/e6d6+9vhD/wAEu5viR4f/ALWhunwVH3ZD3rzf9rz4f3Hwo+MWteOL1dsUr7vTpX9An/BLH4zeAfF3wtit7qFJZXRfmzX7Bm+b4mnhYVqG1kfl+X5fSq4lwqn5Lf8ADm68/wCfub/v41QXH/BHO+jj3C5n/wC/j1/ZHb+EPC9zbrOtquHGakbwL4XkG1rVa+N/12xn8x9X/qxQP4xY/wDgkHfK37yaU/7zvX2P+yf/AMEzY/h34m/tCQc7w27Jr+mabwD4RhQyNZrgVT0XTfCn2ow2FsqOG/horcY4urSlTvoyYcMUI1FLqZ/wg8JL4N8KppC/w4r1iqMcccPyxL8tXq+OqybfOz6iEOSKSCiiioLCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//V/v4ooooAKKKKACiiigAooooAKKKKACiiigAooooAhZdtZuqabDq1r9lufutWxTWXdS5UVzH4N/8ABQL9mOTxHqE+uaXbeYIWMm7Ffzn+LtDvND1y5sLhNnkvtr+9vx14WsfE3ha+024hR3miK5YV/Lh+3N+yPefDua88VWsLP9oYy7U5/lU1KrtY1oxVz5R/Zl+NGteC/GdnuOy3T+LNf1bfs3/HLSfiVpcLR3PmsIh+gr+Myxs7i1ttu1on/I1+gv7Hv7Ul58E76HTb+R5POfZ82T1NckMXZ2Z11MJdXR/XXHJG6bl6VLXz78Hfi5Y+PvDNrfiZN0i/dyM179Htx8pzXcpJq55zTTsySims22miT1oHys+af2iPEraf4I1WxU/fiK1/Ij480tbj4kavcSL9+4P8q/pg/bI8YNo0N1Z5++pWv5v/ABdMtx4ovLn1l3V8ZxDi3F8h9ZkNC6bPur9jf4c3h8aWOrLD8i4+b8q/ps0tRHptsnpEv8q/HH9ifT0bQ7WXyd3T5sV+y8K/6Oi/7Ir2sladG54ubt+1aFqxVeplXbXsnl810OooooAKKKKACiiigCvUrFStJJ2qOp5bajlIzdWuI4tPuGb+438q/nT/AGntca88e3lru+Wv3s+JPiJdF02bc2Mxn+Vfzo/G64bVPiJdzdm/xr8O8WMzlTjGjB9T9I4BwiqVpVGeX+DdNim8UWMfZpRX9FX7PvhG10fw/YX0S8sgNfg78M/Csl94ssJAPuyiv6PvhjpX9n+DdO9ohXi+E9Gc8TUqT2Vj0vECuoqMEzpPE2sR6fp7yRn56+WdWl1jxZfD5N6769E8Salcahr39kqG2tXpHhHwhHose6YKWPzfNz1r9dxdGrj63JtBH53Rqxw9Pne5B4P8I2um2cV1jbL/ABV6Gq5+Y1IsQU4UcU/y2/z/APrr6ihhqdGmqdNHmVarm+dkX8f4VYT7tRrH+FTV0cupmFRydqkqOTtSauB5f8W/B9r468F3Hh+8G5JK/jn/AOCmH7F/jDwT4uTXvhzprTCKcSsyjHvX9s3lh15ryX4jfCrQfHmnz2t9ZwTPKhXdIoNe/kGc1Muq81ro8XOcpWMp26n8T/7Pv/BQT9oH4SyQ+EfECvBbWeF+ZjxX6oeEf+CqDXFj5mqalsf/AGmr0346f8Eb5viRq1zqmkstt5zf8s2C/wDs1fDGrf8ABB/xxHqAtY9SnXP92f8A+vX206+TY336jUWfIKjmeFfs4ptH1RrX/BUtRbv/AGdqWX2nb81fINn/AMFIP2iPGfjx9J0dXmtDjb+8PrXfaL/wQL8cW8iTSanOw+980/8A9evvr4B/8ElpPhbqcOoagyzFMffYN0rmrTyfDwfsmmzelSzKtUXMmkfdn7C/jTxt4y8HtdeNYmjm8oN8xzzkV99blYZry34c+A7fwLY/YrdFT5cfLXpit/EK/Oq8k6jcNj72hFwppM/Az/gqd/yTHV/x/k1fmb/wQx/4/r//AK6zf+hGv6G/2sv2RLj4/eFbzQoX2/ac/wAWK+Xf2Cf+CZ15+yhNcSXEm/znkb/WbvvEn1r7TB5tRp5dKg3qz5LE4CtLHKaWh+y3hn/kCw/Stx/u1Q0uz+w2SWv9ytGvh5y1Pso6JHI+L/8AkWtQ/wCvWX/0A1/BD8aLeb/huTVJNvG5f/QzX9+Os2A1HTZ7Nf8AltE6fmMV+Bnjj/gkTeeKvjhc/FBZMC4x/wAtPcn1r67hfMaWD9p7V7o+S4jwFXESi6SvZn3N/wAE6f8AkRT/ANcF/wDZa/SR1/ir5l/Zt+CMnwV0FtJkOdyBeuelfT1fOZhVVSrKSPosBTccPCDPlf8Aa+8JTeNPgtf6Hbp5ry/w/ga/iD+NXw78ffs//ECK6srNoYlvN7N04L5r/QS1Gwiv7Y2syq6H+E1+X37X3/BP6w/aEZ5rGFIj/s4WvouGc7jhJOFX4GeHxBlNTE2qUt0fmR8Cv+ClFn4Y8A2Gh6tqXlSQrtYZr9TPgH+1hH8UjDNY3PnI+O9fiD4o/wCCDHjW+1ea4s9UniQ/wrPgf+hV+sn7GP8AwTz1z4A6PDa6ldyzNGo+/Lu6fjXo5zSytUnVoyvNnFls8dzqE1oj9f8AzvO0MzD+OEt+lfyW/wDBV1lXS9R3f7Vf1qw2hj0kWHpFs/TFfkD+19/wTnvP2hrO5t4ZGXzs/wAeOteDw7jaWGxPPNnr57h6lehyU0fE3/BAJlb4SzY/59x/6GK/pmtv9SK/LP8A4J1/sJ3n7Hfg1/Dt1Kzs0QT5m3dCK/U+NNsYU9qniDG08TipVYPRmmR0JUsMo1FqSVnX1rHeWktpJ0kG3860ar189bW57Mo6H4J/8FTv2NbXxh8OptQ8K232i8lVm2qO9fzV/Dn4kftHfsra5BodnZPb2sbfN8xHT/gNf6FGuaDp+t2v2fUIUmT0cZr8t/2lP+Cc+j/GaSeXTbeK3aXPzJhetfd5DxDTp0vYYhXifG5rkdR1PbUNz8sfhH/wVU8QtZw2via/aJ0Xa3zV7TqH/BUq1jh/c6nub/er5e8af8EIPGFteS3VnfzoHbdtWb1/GuR0v/ghP46vLjyW1S4/4FP/APXr2nSyWb5vaHlQq5qlZwZtfFT/AIKnfFq6uDa+C5muA/yrtkr7E/4Jc/tKftA/F74lzW/xEgdLN5htZmJ4wK4X4Y/8EPda8I3lvdaldtN5bbm3y5/rX7Qfs5/st2PwT8mSGFEeP+JcV4mb4rLoUXSw9m2ejluCx9StGrWbSR9oVIzfwio2YbqbvWvhPfPtixu+XdTqr7t3PWpk+7VFcrHUU1m206gOVhRRRQSFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQB//1v7+KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiimtwtAEci+Z8jdDXhnxb+Dfhf4iab9k1i284bdte7q26nUt0NSsz+UH9rL9knxF4T8RT63osPlafFntX5z2twbS+DL9+F/wBQa/te+Mnwl034h+GLjSbzbtk/vV/O/wDtLfsTyfDu8km8K2fnB33NsHr1rwsywsl+8ie/l2Lj8Eyj+yz+1VfeC9Yht/EF1/oqY2rnFf0EfB39oLwn8Q9NFzp753475r+QvUvBN5pVwba+iaJh/C1fWnwE/aG1z4YywaXZ7vKXC/KfSvKw2duk/Zs78XlKqLngf1qRuJoxIO9SJ96vg/8AZz/adsfHcEcOuXipxt+Y19yWuoWV9B9os5VdD0Za+qp4inUjdM+Vnh5U3aZ+PP7f/iqx0nWJLOZvmckV+F15bSatrk0lv3ev1z/4KTQ2snjMeY/zeaa/NXwLoK3WqMyru+avy/P8SqmK5Ez9DyalyYb2h/RZ+w74R0+H4Uw3U0f74bfm/Cvu8rtUBegr5Y/ZJtTY/DGKP/c/lX1Nvav0jKqXLQj6Hw2NnevNjk2/jUlVUZutTKwC16Jw+hJRUYf1pu9qBE1FJlaaz46UAPoqLzG/z/8AqpVf1oAGZTUdN3rUE17aW/8ArnxWc5pbhGV9j4y/ay8Tf2DpvXG5P51+Iviy4jv9clux3r9Rv29Net2s41tXz8o+7X5Ns/mNur+UPErMXiM0lST0ifuvA2C9nhFW6s+v/wBnHwr/AGtqNvdbd2GDV+5vhe3+z+HbSH+6lfln+xfoK32l/adv3Vr9YNNXy7KOH+6tfq/hXgEsA6j6nwfGeJ58Y49mUf8AhH9NM/2xk/eCttRtG2n7fl3Ub2r9XhSUNkfETbe4Kfm+tDH5vpQn3qH+9WnMgiTUVGX9Kdu+XdTDlY6o2X+IUKwC0B/WgUYjl4WnVH5n+f8AIp275d1ASiRsu2s2TS7OR/MZea0dxYc0lKMuxEokKRrGvAqanPtam0oxuPlSIf4/xqT+D8KPl3feqYR+tabIUYrch8rctRrFirHzL8tCttqOVF8upIn3aH+7TVYk05/u0cyEQ0mFpaT5t3tS9QeuxKm38akqFW21NTiKImBnNMkUsOKydc1OHS7BryV9ijvXh8vxs0KO7Fr9tTcWx1rz8Zm1DCNRqytc6qOFqVVeKue7NYW7NuYfNViOFY1/djiquj6hFqOnpdxPvV+9aBZuld8KnMlK+hyyppMavbdTnjXrVO6vLWzXdcOEH+1WLD4w8O3Fx9khu0MnpWVStTg/elYqNJyWiOmjjXrU1QwurL8tTVqrCjEKbsWnU1m20+ZAD/doVflwaRWLNT6YGfd6db3n+uGaqw6Np9ucxpzWpvajb8u6iU2LkW5DtK/cp0fzfLTqd8y1D13HGTI2XdTlX+EV498VPHlx4P8ADs2qW5wyV8xfCP8AaS1jxpdGG4Zjtcr8x9DXzWM4mwuHxMcLUerPUoZVWq0XWhsj79+fd8tOXd+NZ2k3TXmnxXTfeeptSvY9Ps3upDhUr6TnXLzdDzYxd+Q0SAetI/3a+Zdf+Omj6XcfZ/tig7tvWvcfCuvw69paX8b7w9efhc5w2IqulSndo6quDq0oqc1odSu7+KnUUV6hxhRUfmf5/wAinb1oAdRTFYs1LvWlzIrlY6iod7VIrbqOZClEdRUZf0pzNto5kEojqKbu+XdUe9qYRiTUU1W3U6gQUUUUAFFFFAH/1/7+KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAZJGsi7Wrh/E3gfw74j0+a3vrOOZ3QqGYV3XzbvaomXbUTSmrMd2tUfhr+0F+wvq15e3OtaejRJLllVa/Lfx38HNa8CagbWbfuHev6/tV0W11iH7PeDK185+Pv2Y/h/4ktZLqaHM38PFfMZrkM6vvUnqfQZdnPs9Kux/Mv8PfHniLwXeCX7VKgRt1fqt8Lf8AgofoOg6PHouoFJZU+8zda4j46fsf6lFvbwva5/CvgjxB8EfFnhWZ7i+g2Yr4KtPGZfL3rs+tjDCZguzPWP2wvjFafGjxQmsaWVCBy/y1yf7OfhtvFOufZF+8rha8Puo5AxWavYvgf4ot/B+t/bGOz5w1fOyzN1cWq1Xuey8F7LC+ypH9LHwH0ZtC8EpZt2xXtSrur4N+Df7UXw5t/DaWupXf7zj0r36y/aG+HN9/x7XPX6V+04DPMJKnGPOr+p+W4nL6yqNuLPc/LPpSV53a/FDwveLuhm3Ka1F8eeHzxvr1Vj6HSSOL6tU6xZ2Wxqhb733a5OTx94fXq+ax7j4peE7f/WSfypPH4VauS+8FhqvSLPRPMapK8fm+NngW3+aSfp9K5u6+O3g/UQbfS58uvvXHUzzCwWlRM1WAqP7LPoFpF+7nFZl9qUNjGXyvFfJus+MPFGobm0U59K5ex/4WpeXSLeD5C3zdeleRU4mVR+zpU3fudkMraV5yR9I33xSsrOUxlV4qpfXlx4k0qTUrUsAv92tjQ/A1leabFNqS/vT96tbxBp9roPha4W14ULXTKjXr0ZVKz0sYqdJSUaa1Pxz/AGtjeM3l3EjPjHWvhu3t2kbatfXH7S2rtqF9IjHOGr5z8F2K6hqyW5XNfyZxE1VzOXL3P3vIIeywCkz9af2FdH8nwu5lH8A/mK/RSEbAq18k/spaLHpXhopGP4K+ua/qbgTAfVcqpryPxHiDEe2x8peZYpuxaE+7Tq+zPnyP7jUv31p9MZljWp5gIql++tctrHizR9FXdfPha84vv2gfh7preXdXO0j3FcNbNcLQf7ySR008LWnrCLZ7X/q6cq7q8Htf2ivhvef6m56/Su80P4h+HfEEmzT5dxpUc4wlf+FUT+Y6mErR1nFnebWFCttpscyyLTvl96713iYeoi7d3NOfrTtqr81YWqeIdN0tWa7bG2olUjTV27CjFvY2Kj8z/P8AkV43qnx48A6SxW8uMbfpVe1+P3w8vP8AVT5/KuB55hE7OovvOqOBxDV+Rntww3zVZHQVw2j+OtB1tQ1jJlTXbxyLIu5a7aFalVXNSdzldOUHaaH1C/3qN7UTNtXd6VtKQbEe7/gVO3buetcTqXjzw/pLN9slxiuHu/j78PbOTy5rn5vwrz62b4SnpVqJfM6YYOrU+GLZ7dRXi9j8ePAN+223uM132leMNF1hh9jfduoo5lhq+lKafzJnhq1P4otHWu5U0jNuofa1R71ru5dDmPM/i5pt3qng2e0s3ZHP8S1+R1x8G/HzeJI5lvJ9iz7v1r9p9Yms47Mtff6qvG5dU+HK3QUP8+favz3i7hejmFaFSrOzXnY+nyXNquEpyhTje/kd98MrG403wZZ2l4zO6L8zNXfVnaTJbyWKNZ/6r+GqWpeINN0pTJdNjFfa4SNPDUI029Ej56pzVKjdtWeL/HTxFNomnvJG+35K/NH4Z/E7VtS+Mx083LlOPlz719gftFfErwvfWLw28uWCba/Mv4T6xZ6f8Zv7UuDiLcOfxr8M44zm2aQVKppdH6Tw7lieBnKpHWx/QhosjNDzz8tbCt/EK8T0P4weC/JA86vQ9H8ZaFrsnl6e+41+1ZfmGGqUoqMk2fntfDVYNtxOppqtuqT5dvvWPfapZablrptuK9RzjFXmcUFfQ2FXdRJJj5a8p1L4yeDdLYpdS421zrftD/Dkcfaf5VwSznBwdpTS+Z1wwNdq6gz3LzGqXd8vtXjVl8b/AAHqLbbab+VelaX4i0vVIxJaHINdNLMMPV/hSTMnRqQ+ONjeVdvzGjcjdaPMWj5f4etdMTKMj4r/AGpJpI/BN3g461+ev7J9zM2pvuO796386/QT9qbLeCbqvz1/ZM/5Ckv/AF1b+dfzxxPJ/wCsNI/UMkiv7Hq+p+4Xhf8A5AMH0rK+IFrcX/hO6trc7XK/w1q+F/8AkAwfStDUmgjs3kuv9Wv3q/ffZe0w/I+q/Q/NpO1W67n4l+NPgv481DXjNHdT48/d+tfqh8D/AA7qWh+Cba0vnLuv96s/UNe+GUV1tuHw+72r2bw/cafcaaJNNOY/4a+D4c4Uw+Excq0ZXb8z3s1ziriKEaU42S8jok+7Qy7qjVttS5Wv0eMj5kh2lRzTE+7WLqnijSdIjLXj4ArzW++O3gHT5MXFxhq48RmuGo/xZJHRTwlap/Djc9oGW+Wl8tv8/wD668Utfj18P7o4hufm/CvQdJ8aaLrUYazfOaihmeFqaQkn8y5YStDWcGjqcBj8tNpqt8u6pE+9Xd5nLHXcbUgXclO2LWXqWsWelx+ZcnAqHVjBXmyrOeiL1FeZ3vxY8J2MmLibFY3/AAvTwH5yw+fyW29q4ZZxhIfFNX9Tojg6r1UWezp96pqw9L1iz1a3S6s2yj/draXdj5q9GnUhUXPB6HNKLTsx1FFFUSFFFFAH/9D+/iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigApCAetLTWbbQBTnsbWeMxyRKc+wr4h/aU+Dmm3XhqbUtiLnNfdlfOf7TF0tt8PZZPr/KvMzelTeHqTkuh34CU1Vgl3P5p/ifoMeg6kYY/u7q6L4I/C5viZrBsP9rbUXxKZtW1ItHz81faP/BPfwvG3jgteJvUyj+Qr+bsEqeNzD2F+p+y4utLC4D2q3seK6/8As/694Z1DbaJOVH90mpLHT/GWguojguWx9a/ocuPhz4RvW8y4s1Zqz2+EvgCT71ghr9HqeHU/io1LM+KhxfdWqRufibpPxS8cadCI/sdwdvsa6mP45eOgv/Hlcfka/YX/AIVB8PP+gclNb4Q/D1W/5ByVjDgPMFtXM58S4V70z8pvD/xW8aa1J5c1rcD/AHhXp9jpeu+IFXzopRu+tfoxa/CzwLat+5sEFbEfgvw7bf6m2UV34bgPFX/fVro5K3EVH/l1Cx8G6X+zu3iKFvtLsmfc12XhX9kO30K8N352ctu+8a+2LfTbO1+W3TFaC/L0r6TB8G4Wl8cbnk1M8rt+67Hl3hv4bW+iKq/Kdtemx2lui7di/lVpPu06vpcNgqOHVqSseVWrzqO82M8tf8//AK684+Ktx9j8E3tx6LXpDNtrxP446ksPw71D12VzZzUVLBzn5P8AI2wUHKrFeaPwR+KniRtY1q5jY52Slf1qv8Hrdb3xdFb/AErzfXrxrrXrzn/lq3869Y/Zw02a/wDiRDCPb+dfxdQk8Rjot9X+p/RdS2HwDS7H7ufA/S/7N0byx6V7krba43wdpLaPZiOT+7XYV/aeU0/ZYWnDsfzpjKvtKzkTK26nU1V2jFOr0jmkReY3+f8A9VeBfFT4rW/gvS57pZVDov3e9e06pfQ6dH503SvxX/am8eahq3j/APsHT5sLKxXatfA8ccRvLcG3S+N6H0PDuU/XcRyz2WpleNv2p/E/jC8msbOJ3UMV+UV5Smi+KvF1x500M43/AFFfVX7L/wABWubz7d4gg8wSZb5h61+l2j/CvwXYwKv2IBhX5bkXCWZ51S+s4upZPufYZjneEy+p7ChTvY/Ce68F+KPDMm62hnOPrXWeEPj94w+Hd15k1vOFDfxCv28uvhn4JuwVksUavkH9pD4A6Pquif8AFO2qxPsPQV0ZvwDj8upe3wdXbsc2E4jw2KqKjiKe52vwZ/aCj8bWMQupVSV8fK1fX0cisBIDnctfz0eA9U1zwH8UrfRbiZgg+8v41+7Pw/8AEEevafG0Z/gH8q+z8PuK62OpuhiPijoeNxJlEcLUU6XwPU6PxFrsei2f2pjtWvyr+P37TGpafrj6Lp+597Fflr7i/aU1mTQ/CP2iM7PlNfjTaxt4w+I1qbj96rv81eF4mZ/iadSODoO17HfwnllKonWqq6Rl6hqHi7xxN5jW8+0t7112neG/FGj2oulhnLfjX7EfD34N+D7PR7WW4slLNEGr0qT4Z+C2Xb9hTFc2A8M8VVoqpOtqzavxbRhLkhDRH5GfDn4zeMvD+uWmktaT7JH2E4r9kPCV9JqHh2zvpl2vJHuK15hffBvwidSivLWyVSjbq9isbeOzs4rWMYVF2197wdkWMy1zhXqcy6HzGdZhRxVpUo2ZeZv4jXzR8cPjUvw9heGGReVr6A164+y6W83pX4s/tkeJ9QvvE1va28rbXlVaOO8/qZdg3Kl8bNeG8tWMxKhLY5jxN+0J4o8YaxNZ28Mrru+XaK51fDfibxDJ9okhnH519afs0/BvT74Qaxq0CyiXH3hX6Lw/DPwbCuI7NBX5jk/BeOzel9ar1dH3PqsbxBhcFU9lRjsfiBJovibwj+9hhnf+LvXafDv9pjxF4c1xbG8jlRBj7wr9gtQ+Gfg26t3WSxU/Ka/MP9pf4I/8IzZzeItMh8lefuilnXCmPyOP1mhV9xFYDO8PmL9lWjq+p+jHwj+JUPxA037YXVvl3V7My/LgV+OH7IPxKm0mzTTb6Xcz4Wv2D0m6+2aZBdD+Nd1frPBXEf8AaeDUp/Gtz43P8r+p4l01seb/ABk1CTTfA891H1H+Ffi7ffFzVk8VQ2534NwF/Wv2e+Na7vAdzn/PFfhzqlnb/wDCXW/H/LwP51+d+KOJq08VBUpWPpuEKNOdKSmrn7u/Ce8k1HwLY3j9XWvFPjdealb2c/2NHf8A3a9k+D+2P4f2Cr/drsNQ0XStU3LeRb91fqM8BUxeW06SerS1+R8h7aOHxMptaXP57PiJqfiO6vJvtEE4G4/eBrx7Q7i8j1jMaN5n93vX7kfHL4d+D7WxleGzUHZur8o/h7o9jefG46bImYdw+X8a/mriThqtgcbGlOV23ufrmR53TxFCpUUbJI3NN1zxdCw2285/A193fss61rmoa15eoQyou8ffFfVnhn4U+Czb5msUJ216FpPgvw9oMnnaXbrE3+zX6zw3wLisLWp1p1brsfB5rxBRxFN0qdOx1VfH/wC0Z411bwyrx6fG8mV/hFfYFcX4k8H6V4jb/ToVlr9GzrC1sRhZUaLsz5fBVI0qynUVz8HfE3jDxn4i1KWFra4Ct7GuCmsfGCXAX7NcfrX732fwX8Ex3HnSWCbq3W+EXgE8tpyV+QUvDDGV7zrVj7uHGNGkuSnTPwIj1/xl4TZZlguP73Q19XfBH9qrU5tai0HUt0YGPvV+jHiz4JeC7+xlW3sI87DX4zfF74Wa58P/ABdca5aboYV+7xXzmb5RmnDlSnWp1Lwv0PVwOOwObQlRlC0z94/CfiS38RWv2iF1f5d3y11j/dr4D/Yl8aXGveFjJeS+adlfoBGytHX79wxnH9oYONbq0fmua4B4XEypdj4n/al/5Ee6/Gvz1/ZM/wCQpL/11b+dfoZ+1T/yJF3X55/smf8AIUl/66t/Ovxjir/koKR97kn/ACKJ+p+4Xhf/AJAMH0rN8fSeX4UuZF7VpeF/+QDB9KyfiF/yKN19K/eJyawba/l/Q/OoR/f/ADPxP+Knji+0vxB5cbt/rx396/Xb9n/UJNS+HNrdS8sf8K/E340f8jEP+u4/9Cr9nv2b/wDkl1l/nsK/EOAcfWq51WhOV1b9T7ziXDU4YGEorU+hPvLurzL4hePLXwbZ/apJFHy1399N5Onyyei1+T37aXjzUBpf2bT5thCla/UeMc9eWYKdWO58pkeX/XcTGk9jzz4t/tUa5fa1Lo+npJKpz9yvnua88YeKG86SC4+b5u9e1/s7/BXUPGF9b+INWTzoTjduHrX63aT8IfAtnaxKLBNwUfyr8XyjhjM+IJe3r1LQfc+6x2b4TLLUqMLtbn4Uf8VhoP8ApEcFwfzr1j4d/tPeJPDeq2+l3cUqA/e3Cv2H1D4R+B7qHyzYJX5l/tIfAObTrqbXtDh8lI8t8orbOeDsyyX/AGmhUul2IwGeYTMH7KtHVn6MfCn4o2vjq1j2yKxK17er+lfiP+xz8R7zQ9dmsdWm3qjsvzV+z3h/Uo9V01LyPoa/VeCeI3muETqfGj43iPK3gcS4rYp+LNebQ9FudRX70Kbq/Jn4rftj60+oz6XaIz+S2z5RX6X/ABekZfBupbOP3Rr8HPDOj/258Rr+G7G9ftFfDeJGcYyjiaeGo1Lcx9DwhgKFSnKrWjex083xU8aeJpvOFtOQ3tVnTYfFl9rFtJJb3AAcetfq98Hfg/4Mk8MpcXVipcY+avcIfhb4HhYNHYIpFcOWeHePxUVXrVtzfFcUYak3SpUzifg3NdL4bs4bhGDBf4q+gKxrPS7GxjENrFsArXT7tfuWWYN4WgqTd7H57ia3tajnYdRRRXoGAUUUUAf/0f7+KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACo32/jSv0qKlKQE29a+W/2spvJ+Gkrf738q+mF4+btXyN+1zfbvhrND/vfyr5zi/Fyw+XVZLsz1MohzYqmvM/AC4/0zWIoz0L7a/Wj9i3wzZ6bq0V5D98sDX5QafaibVoW/26/Y/wDZCt2jvId394V/OHAEvbZrGUu5+u8W/u8FyJ9D9Kk2ldtL5a/5/wD10nl/5/yakr+suVH4hzMjZdvzCo6sUURiHMyFl202rFJharliSQbf4sUbd3HWrFFTyoCH5l+WpqKKYEcnavlf9oLVFj8H39ozdVr6mZdtfCP7S140el3cf1r5XjOv7PLpPyZ7OSUubFRXmj8R9Wt411q5Ze8p/nX1R+yppcf/AAsSGZfb+dfLupfNqk3u5/nX3R+yn4dZfFFvfH2r+U+GMP7fMaa8z904irezwTXkftpCuIwf9mnUKf3e31pyfer+0owtTP5ylqyRPu06iitAPK/irfNY6L5i/wB01+Gvj64XWPjZZ+Z90ymv2r+Ou7/hHPl9DX4haoPM+NVgG/561+CeKzbxUIdLo/S+DKS9nKXkz9yvhT4ftdM0Kzkh7xCvY/LX/P8A+uuG8A2wh8OWLZ/5YL/Ku8r9mySmoYWMfI/P8ZO9Vsj8v/P+TWPq+lwalbtHL/drcqrL91q769NSpuBzQdnc/n/+Nlj/AGL8amuIflUZ/nX6dfsreJG1rTQuc4Svzw/aQhim+KEsa/eOf519sfsW2MlnYv5hz8pr+eOC70M/qUobNs/UOIIqWWRk97Hv/wC0J4Zl8TeFfsdsm9tpr8S/E2leJvAPjaG4jhZFiY1/RZLbxSjZKFYf7VfJvxa/Zxt/Hk0t3CiozZ+7xX23H3B1bMGsVhvjR89w5n0cG3Sq/Az55+FP7UCmGG01y52bFx1r7O8P/Hb4fahbjdfLvNfmP4w/Ys17RZHuLe4df4vlkrwXVvA/irwDI1w01wVT3Jr4TB8WZ3lKSxMLwXc+grZHlmOvOlUs+x/QNo/ibRNcj8zTpd4rc+Vvmr8T/gv+1Zd+Fbq30PUNzNMwT5xX6/8Ag3xJF4k0e2voyp85N3y1+ucKcZ4bNk4xfvrdHxebZHXwLXOtC34x/wCQDLX4dftSf8jjaf8AXda/cXxku3QZa/Dz9qf/AJHO0/67pXyPizL/AGZfI+i4Hj/tP3n6W/s3/wDIpWVfX1fIv7N//Iq2H+6K+vH+9X3nB8f+E+n6I+WzpWxU35jdu7jrXzL+1FpK3/w7lj69f5V9P/KleFfHzb/whb+b7128R0I1cBVhPsYZZNwr02u5+I/w/vpvDPi6xs+m+ULX78+BbjzfCNhJ6xCv5+tW2/8ACytP8np9o7V+/Xw2/wCRI03P/PAV+P8AhRWaxNel0R9vxrH93Sn1Zy3x2maL4d3br/nivwwW+kuvFkO7/n4/rX7o/HOH7R8P7mP1/wAK/DSTT/sfi6H/AK+P60vFT/eoehfBkl7GR+7nwh3N8P7A/wCzXpir/Ea87+EH/IgWX+5XpT/er9ryiL+qQ9F+R8Fjop1Z+rPm/wCPP/IKl/3D/KvyE+FX/JwB/wB4fzr9a/2ib77Lpb/7n9K/JD4Rv53x8Mn+0P51+HeIcv8AhXpLzR+h8LQf1Gq/I/fPQ/8AU/8AAa2qyND/AOPYf7tav8f4V+84KN6ED81rx99jq53WvFWi6ApbUpvKqxrmp/2Tppvj2r8pv2ovjpcNqQ02zcjeQny185xRxNTynDuct+x6eT5XUx1VU0fZfjb9oXwjpcZW1vV3rXz/AKh+1N/z63O78a+NfA/wK8TfFm8WZZ51Wb/aIr6Nsf2ANct8NJduf+B//ZV+TUuIOIcx/e4el7nkfZPL8qwvuVal5nUW/wC05qUiusk3DZ718h/Gz4oSeKrOWFpc5zX1s37DeqRwn/SG+Vf+elfI3xi/Z9vPAVrLfTSM4Gf4s14fEsM9eG/2um+RHp5RLLlXj7GWp9J/sL3lxZaCYV+6UH86/WGzLNZo47rX5J/sSzeZov8AwH+tfrdp/wDx4R/7tfqvhi28sjc+R4vj/t8/U+L/ANqX/kSbmvz1/ZM/5Ckv/XVv51+hn7VP/IkXdfnn+yZ/yFJf+urfzr4Pir/koKR9Fkn/ACJ6vqfuF4X/AOQDB9KyfiF/yKN19K1vC/8AyAYPpWT8Qv8AkUbr6V+71P8Ac5en6H51H/eF6n4J/Gj/AJGIf9dx/wChV+0H7Np3fC2xA/zxX4v/ABo/5GIf9dx/6FX7Qfs1/wDJMLL/AD2r8F8O/wDkd1vT9T9E4r/5F9L1PYPFEhh8O3TDslfhj+0hqk2qahcW83QMa/crxc3/ABTd5/uV+D/7QC7dUuf9417/AIuSkqFNHBwFBOvdn6Kfsq694T0j4fxreTqjjH8q+tv+FkeDdu1buvwZ8F+Lta0/SVht1n2/7IOP0rsP+E98Relx+TV5PD/H1TBYOnQhTvZHXmnDKrYmVTm3Z+2g+JHg9f8Al5rx74zeJ/Beq+B73FypYrX5Wf8ACe+I/Sf8nrN1bxd4g1KxezYTtv8AZ67sy8RamJoyouktUznw3Cyp1Yz5tjgfDeqR+H/FUsmmn5WuP5mv3l+Ct8+oeAba5k6t/hX4JeG/B+qTaskrQy8yhuh9a/ef4HWr2fw/toZF2sv976VxeFHto16ikrKx0ccSpOnHld2S/F6KRvBepSj7vlGvw3+GszN8Tr9W/wCfiv3i+KQX/hAdU/64H+dfg38N/wDkq2o/9fX/AMTWniVG2aYd/wBbhwbK+Ern7q/B/wD5FRPwr1Nl215Z8H/+RUT8K9Zr9tyyP+yw9D8+xkf30vUr1KnSkEfrUlegcv8AdCiiigQUUUUAf//S/v4ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAY/Soqmf7tQ0pSHL4SOTJjZ/avg39rK+ZvBc0P1/lX3tMo8pz/smvzZ/asvpG0CeH618J4hVrZVL0Z7/DkOfF0/U/IXQIWbWLdfV6/ar9ljTfsq202PvYr8YfDabtftk/26/db9nax8rTLNmGMqK/E/CynzZhfsfp3Hc+TDxgj7EVt1Opqrtp1f1PE/EQooopgFFFFABRRRQAUUUUAFfnX+1Bq1rDDc2sn3jmv0Sf7tfk7+1pfQx6pNGzfNzX5/4i1OTK2fS8Mw58Wj8vb7nVX295f61+pn7LOkqptrrHpX5XtzqX+8/9a/aD9mHSF/sC2uPpX4F4e0+bMkfq3Gtbkwa8z9Avl2iim7fl207OOa/ryM1sfghYopqtuGaU9DTA8v8AihpMmsaP9ni5+U1+GfxMsm8M/Gi1a442Smv6DJ4VuP3bV+Q37VXwpum8VP4ms4Wfy2Lblr8d8U8qq1KUcRBXsz7vg7Gxp1ZUZvRo/Qb4J+NLXxFo9rbQncyRBfyFfQlfiT+zV8bNQ8M6k9nqztbohK/Ma/Tzw78cPBt9arJdalECfeva4Q4wwmIwsYVZWmu+h5ud5HWw9Z8iuj3quM8W65b6LaebP6VxWr/GTwba27yW2pREr718E/tCftITPYtb6LN5x2lflNelxBxjg8LhpNVLvyOTLMmrYiqlynyD8VtSuPEfxt8m0OQ7H+dfrB+zL4butB00NcD7yfzr8nfhJ4d8SeNPidba9eWz7G/ib61+93hfQ4tJ0+FY/wC4P5V+d+GuXyxGKnjprrp8z6ji/FRpUaeHh0R1TAbdy00ruWvLfip4rvvCei/brHcW2n7tfLOj/tOTf2hHaatP5Wf7xr9YzDiTDYSt7Cu7HxmFymtiI89NH3Ff6Lp+ortuk3V5b4y+EfhHWNPKtbZeobT40eDZbdHbUk3MPWud8dfHHwvpehm7sb9HcZ4U152PzbKqtGSqOL08jShhMXCouVP8T8if2jfBtr4F+ItpDpaeWon/AMa/Rb9lnxVeapDaWdw+4IoWvzV+NXjS++JHjy2uod0ytPX6Zfsw+EZNHhtryRNucNX41wVpncnQ/h3/AAP0HP7rLIKr8dj7E8af8gGWvw4/an/5HO0/67pX7j+NP+QDLX4Y/tXM0PimGZf4JQ1faeLX+7L5HjcDxvX0P02/Zt/5Fay/3a+vn+9X5T/s+/G7T9N022sby5WJUx96vvbT/jJ4HuLfzJdSi3fWvoeDuIMJHBRi5pNLueJneW1lXk+R7nr3zbfevk39rDxHDY/DuQQth13fyrste+N/hW1t3+y6gh+U96/Lb49fHDWPHE03hyz3TR87dprk4040wtLBypUZXnJW0OjIsjrVa8ZSVkjwr4W2N54q8VWN83OyXdX9CngWFrfwjYQN2iFflL+yH8J5rixTUNQh2Oihua/XjS4Fs9OhtV/gXbXleFuWSp0J4qa+I7ONMdGrWVKO0TzX4z/8iLc/57GvxB1T/kbbf/r5H/oVftl8d5mt/h9cyL/ng1+Gf26S88XQs3/Px/WvF8U/95o+n6nocGR/dSZ+9Hwf/wCRDsP9yvSn+9XmfwhfPgGwz/dr0Zt26v2zKJpYWHovyPhcV/Gn6s+W/wBpC1kuNLcx/wByvyX+D8LR/Hra394fzr9kPjbYXF9pcn2dN/7r+lfizoOqN4X+N0t5dfugMfM31r8K8Rk6eaU6s9rn6HwpPmwlSkt7H9Buif8AHuv+7Wy3y9a+c/h/8ZvCOoaaZLvUUBC/xGvUdB8eaD4iuGt9NukmP+zX7LlOeYWrSpxp1Fd+Z+fYnBVoSlzoxvi9ffYPBVxcZxj/AAr8QfF19b+JvFkK3Hz/AOkBf1r9zviZoq694Tm0/Gd9fh78ZPBereAfEkU1jA23zQfl+tflfipSre0hVteB9rwW43lC/vn7IfBHwboWn+C7G8tYsSlfvV7o/wArfL3r83fgN+0VmwttF1ifyViwvzGvr5vjF4Lb/mIxV9xw1xHln1SHJJKyXZHzeaZbiYYiXOmz2CX/AFL/AO6a/K39riZv7HnH1r7I8SfHTwvY2kptb+NvkPf2r8hfjd8Vte8ca5Po9orzRN/dr5jxD4twjwjoUndvsexwplVb6yqslZI+kv2G4Wk0PK/3R/Ov1xsv+POL/dr84P2FfBt1Z+F3k1CIxNsH3vrX6Rx/uYxH/dWve8NKMoZXTb6o4OKq6qY+XL3Pi/8Aap/5Eq7/ABr88v2Tv+Qo/wD11f8AnX6D/tTShvA91/ntX5/fskqrak//AF1b+dfn3FP/ACUVI+nyaX/CRP1P288L/wDIBg+lZPxC/wCRRuvpWt4X2/2DDn+7WT8Qv+RRuvpX7pVa+ptf3f0PzqP+8L1PwT+NH/IxD/ruP/Qq/aD9mv8A5JhZf57V+KfxzmaHxErf9Nx/Ov2o/Zlk8z4VWTf56Cvwjw7j/wALlb0/U/Q+KY/8J1J+Z7N4nhaXQbqNf4kr8Nf2m9FuNLvJrib7rNX7zXUIuoHhPevzN/bW+F9xdaD9o0iHznKbvl+tfdeJmVSxeB9pBX5T5/hHGRoYpKT0Zrfsv+Ffh1r3gmNdUtt85x3Hp9K+wF+Bfw5Zdws+v0/wr8Wfg/8AFzxJ8P8AWIdFu0eFB97dX6oeE/2htDv7dPtd8obaPvGvneCs/wArnhlhcRFKcdNUjuz/AC7F06zq0m2meq/8KM+HP/Pn/wCg/wCFIvwM+HR/5c/8/lWPN8a/B6w+YNQiz9a4bxF+0NoNjpsstpfozj7u0197Wx+SQV7R/A8CNHHSdlf8T1u3+C/w/tWVoLX7v0/wr0TTdNt9Kt1s7MbUWvk34K/HS++IGoS2krl1Ryq8+lfXdq7SRrIa9XI8VgcTHmwkVb0PPx9OvTly1WcF8U7qOPwLqkcn/PA1+FPw8khb4paht6/aK/b74wRySeDNSZV/5ZGvwx+GK/8AF0L8f9PFfkHiQ280w67H33B1NfVazP3b+D//ACKifhXrNeTfB/8A5FRPwr1mv3LK/wDdYeh8DjP4s/UKKKK7ThCiiigAooooA//T/v4ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAY/SoqlfpTP4PxqZFdBszDynH+ya/MX9qqTdpM6/Wv04k/wBS7Hupr8rf2qL6P7HOn1r898SHyZbJH1HCy5sXD1PzF8JrnxLZr/01Ff0CfAu1WLw/YSYxlBX4A+DxnxVZf9dRX9E3wft408Kaey/88hX5V4Rxvi5P0PufEWVqcUe1UUUV/TJ+OBRRRQAUUUUAFFFFABRRRQBHJ2r8Tf2yr6RfGTxqf4jX7ZS/cr8F/wBtK8mX4jOn8O41+R+LeJdPL1Huz7bgmip4/XsfHtuub6LP98fzr99v2ZdBYeAbO7r8C7GGSa+haP8Avj+df0Sfs2RmP4Y2at1/+tX5v4T0VPMZN9j7TxBq2w1OC7n0Iy/xCmtgKKkXd/FQy7q/qGS6n4v1ETpT6KKsJFeuD8beD9P8TaPNZtCrvL/FXfSe3WoUb+GsMThqeIi4VVox0puD50fkf8Qv2NfFVxdTXWiu8OSW+SvnfUPgD8TvD8zJ9vuML71++1xbx3C7Wrjr/wABaDqDZnXJPtX5Zmnhdhq9R1KDtfzPs8FxfiKUeSpqvQ/Diz+DnxH1X939vuGz/n0r0rwr+x3441e48zULiWVC33Wr9cLf4a+HbRg8afpXYWOk2mn4W2XpXLgPCfDQqJ1pN/MvEcaV2mqSt8jwn4S/B3TfBGjpb3VsvnJj5mHNfQ8ZwoX+7T2VWWmqu2v1TAZZSwVJUqKsj42viKmIk6lR6nnnxH8JzeLNJ+ww/e2mvy9+KH7JPji61I6nptxKiDP3a/YXb826qN1psF4pjm6Gvn+JeEcNmutXc9PKc+rYD4D+f3Uvg/8AEjw+/lzXtx97b1rWs/gf8RvEEIja+nKn+Gv241D4X+GdQO64T9KsWvw38P2Q/cp+lfnsfCRe01lp6n0z42qWuoq/ofmb8Jv2Q/EMFxDf6rvkMXzfNX6deEfDEfh3T4LfZgxLtrotO0+Gxj8uGtKv0Lh/hHCZWv3S17ny+Z53iMa71Tm/Gn/IBlr8Nf2sNr+IEt/4ncLX7ieNGxoLqK/DX9qJWPjK2Vv+e4r4nxc1wyXofT8Du1e5wfhv4E+NNV0+LUtPnlRX+7trro/gX8UIW+W/uMfWv0g+AXhrT9Q8I2XnL95a+pF+HOgMvzJ+leBlXhtDF4WNWnO1/M78XxlVpVpU2vwPxPh+BXxIvGEbXtw2flr3r4afsb+Jo9STWtWLyI2PvV+nUXw+0OFtyJ+ldla2sNnCLeHotfTZV4VYahUVSu27eZ4eM4urVY8sNDz3wD4Fs/CNl9njhVPl216Yke3pxUfze1WM/Lk1+r4bDU6NJUqSskfIVasqknOZ5f8AFjQ5PEPg+fS4+r1+Wdr+zLrq+IEvMvtE+79a/ZG6t47iMxy/dasRfC+lq3mBea+U4k4RpZnVjVn0PYyrO6uCg40+pk/D3SX0Xwna6bJ1iWu0Zd1NhhWGMRr0pzbv4a+qwuGVKlGkuiPIrTdSTm+pnajp1vf2kkUw370K/mK/Jj42fsh+JNQ8QXHibSy8Qf8Au1+vVUNQ0+31GHybj7teBxFw1RzWl7OqtUehlWb1sBU5qR+AUfwb+I2lyC3jvbgbvl619xfso/Dvxf4b177XrVzLKhcNtevuSb4Y+G5pBIyciuk03wtpujtmzXFfG5D4bxwWKjX5r2fc9/M+KHi6Lp238jcaFZF8uYZFfN/xg+C9t46V2tYVz7CvpKPvTvvLX6PmGWUcbSdKoro+UwuKq4ep7SD1PxT8Xfso+OtIvJL6wnliQ/d215TN8I/iNDN5LX1x+f8A9av3o1DQLHUV23C7q5WT4W+G5pPMZOfpX5PivCWi5N0ZNL1PtqPGtW371X+R+LNn+zz8Stcwv224/P8A+tX0l8L/ANj3XNP1BNU1jdMvG7fX6Sw+BdFsf9SvSurtbVbSPy4/u135b4V4WlJTrNu3mcmM4yxNSHJT0Xocf4J8I2nhOz+y20SxDbt2rXcP92pmKtQvz9a/U8Lh6dCmqUFZI+QnVlOXPM+Xfjt8O77xV4Xube3LfPXyl+zj+zzrXhu6e4uGb75b9a/UK9s4byE2033TVDTdDstJ/wCPddua+PzDgyjisfHGPdHs4bPqtLDSoQ2ZLo1o1jpsVrJ95KzPGFi2peH57OPq9dNUckayR+W33TX2U8Nek6XS1jxY1Wp+0Z+PfxO/Zj1zxNrAuLdn2+aG/Wv0s+Cvhafwn4DttHm6xf3vpXeyeHbCRtzCtu3gjtYfJjr47I+DqOAxcsVHdnuY/PKuLoxoS2RZRNtc14g8P2OuQ+TfQrMNv8VdFvam19hiKcakXGS0Z4am4O6Pyz+MX7Iesa1q0ur6GGhXnbsr5Zuv2dfiNobMv2ycV+9k8EdxH5cnSuSuvAuh33+uHX2r8rzbwuwtao6tG6b8z7HA8X16dNU6mqR+EjfCH4jXDfZlvbjj3rptH/Zd+JWtEI15cENX7SR/C3w1HJ5ip+ldDZ+D9JsWVoV6V5tDwlpp/vajt6ndPjaql+7S+4+LP2a/2dfEnwxn+1axI77sn5vevvC3j8uIR1I0YjVVXtTfLav07Isgo5VQVGjsfGZhj6uMqOrV3OV8eaX/AGp4Tv7FRzLFtr8o/Af7NutWfxAvtUk34efctfsPNGs0ZjboawLXwvptrcG4jHJ+avJz/hOlmVaFae8TsyrO6mEpVIR+0Zvw/wBGk0PQ1s5eoxXeUyONY12rT6+ww1H2VKMI9DyKk+ebmwooorYzCiiigAooooA//9T+/iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigBrNtqGpX6VFS5kXES6/wCPWT/dNfkF+1MzGS5/Gv19uv8Aj1k/3TX5B/tS/fufxr828T/+RafX8Hf72j88fA5z4wsB6yiv6Q/hVZrD4L02T/pkK/m78D/8jpp3/Xev6Uvhj8vgfSx/0xFfnXg4k8TVfkj6bxFm/cR6FRRRX9Hn5OFFFFABRRRQAUUUUAFFFFAGfqE3kx7q/A/9sqZpviQW/wBp6/eLX5VhtdzV+Cv7XEy3HxDdl/vGvxLxhn/ssV5n6HwDSvjL+R8/+EbZptQh+XPzj+df0K/ACLy/h3ar/npX4OfCnTxd6jH8ufnH86/fr4Mw/Z/A9vH/AJ6V4fg9QvWqVLdD1PEKrqqZ65RRRX9En5QFFFFAEfl/5/yaTy2/z/8ArqWilyoCLy2/z/8Aro8tv8//AK6lprNtokVzMrs22hW3USbnqNW20c0v5Sb+ZZ8tv8//AK6Xy/8AP+TRH3pr/epKb2YttSTYtN8v/P8Ak1JRVDG7FoZdwxTqKAIvLb/P/wCuk3fLtqaoWXbSlqBy/i+JpNDlxya/En9qLStSk8ZWrRwOy+evav3WmhjuIzHIMrXz78RPg/pfijUo7r7Mp2MGr8845yCrmlFQpbo+l4czWOCq800cl+znZ3EPhWwWZGT5f4q+ta5Xwr4dtdC0uKzjRU2LXUfx/hX1PD2CeFw0aE90jx8fXVatKoiaPvR5f+f8mhG/hqSvd5mcVrDWXdQy7qdRUlczG7fl20zy2/z/APrqWigOZkXlt/n/APXS+X/n/JqSmv8AdoDmI2XbR/B+NRO+2lXd/FRypq5nGSJo+9OZd1Rr8p+apqmMSiLy2/z/APro8tv8/wD66e/3aFUr1qiojPLb/P8A+unqu2nUUClIY6bqXb8u2nUUCIvLb/P/AOunIm2n0UFczGeWv+f/ANdKy7qdRQSRhPWnMu6nUUBLUi8tv8//AK6UJ61JRQVzMay7qGXdTqKA5mReW3+f/wBdHlt/n/8AXUtFAczCiiilGJIVH5f+f8mpKKYDVXbTqKKACiiigAooooAKKKKACiiigD//1f7+KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAGsu6oWwG21YqF/vUpSKiQzt+4df9k1+Q/7UQ3STj61+vEi7oX/3TX5QftS6W0cdxcH7vNfm3iYm8sZ9bwg0sYrn57/DexhuPF1gzf8APUV/Rv8ADuPy/BenL/diFfzrfC//AJGyw/661/Rb8PP+RP0//rlXw3g/Be0qv0PpPET4oo7ZPu06iiv6DPywKKKKACiiigAooooAKKKKAOR8WsFsua/Bf9qhlbx4+3+8a/dT4gXX2fS8j3r8GP2lLr7V40d/9o1+FeMU/wBzGPmfpfh+v9pb8il8DbWa41ZBCM/PX72fCmN4vCMKyda/En9mFI21ZQy5+av3M8AjHh2Kl4PQfs5TDxAlfEWO0ooor92PzQKKKKAIvMb/AD/+qpMrTJO1R0uZBy6EvmL/AJ//AFVFM3y7lpqtuok+VM0ox1FLaR/O7/wUz/b08efs6/ERPD3hyZkiM5T5Wx2NfO/7Lf8AwU0+IfxJ8Qf2fqlwxXeF+9Xx/wD8F6pJm+OUSxuV/wBKb+Rr4L/YLjuofHCyea3+tHev2XA5BQqZV7Zx1sfl+KzWssY4KWlz/QA+Cviy68YeEU1a4bLNiu68V+JNO8PaTc315L5flozfkK8D/ZFZm+F8bMf7n8q+Z/2+vjdD8OfD9/p5mWNpYCvX1FflscK6mJ9lHufoM8V7LDKrM+X/AIt/8FIvDvhHxPdaLFqeDC3TNfeX7LPx3vfjJ4bTWrST7REVDZz61/B/rXgvxN8dvjtqdvY3s586Ubdkh71/ap/wSx+D2ofCr4MjR9WLu4RPmc5PH1r7TiLI6GAwsbP33Y+XyfM6+KrtdD9UoZGMYJqTe1Nrh/iB4sj8G6CdWmKqFz96vzqEXNpI+0c7KTPnv44ftXfDP4O6l/ZfijUltpt23DV8uy/8FF/g/wCYca2u38P8a/mX/wCCzXxU1rx58Y47vRb+WJBcMdsTEDofSvx8i1bxZJGF/tK4+X/pof8AGv1fKeBFiaEasna5+f4/iirTquMFof6XPwn/AGiPh78QtPik0m/WZ3xtr6QVsqrL3r+HP/gm3+1Fq2l/ELS/A+oXcr78ffJPQ1/bl4fv49R0e0uIyp3wq35ivh+IMkeX1uQ+oyXNVjKd3ubVO2/LuqRPu06vn+VHu83YhU4NSM22hl3VX3fNtpbDiTB/Wnb1qGR8NRT5URKRYprMF60LwtR/M1EpD+yOL+lcL8RtauNB8H3WqW/34xxXcbGryX45fu/hlqR/2K1o6ySJqS/ds/nl/aq/4KMfET4Y300OnzMmx9v3sd65X9jP/gpj8Qvi58XIfCuqXLOj7f4s9TX5S/8ABRj7RJrV1h2X976+9eQ/8EtFuh+1Ba7pSR+7+XPvX7Jh+HcPPK3WtrY/Kp5rW+tcvN1P9D7Rbx7y3WST+7Wxvaub8Nq32MfQV0VfjdbSbUT9Potumrjt7U4P61HTlXdWXNL+U3iTUUUx320xiM38Io8z/P8AkVHu3c9aKWopSJfMX/P/AOqkL+lN2NQy7an5jV7kituGadUKttqaqiAUUVG7fw0wAv6UB/Wo6cn3qnmE9GTUUU1l3VQx1Rl/Sm8/dpyL/FSlIcbB5n+f8ijzP8/5FR0URj/eJ1JFb+E1JVepVYmnLQOa4+iiigYUxmIpd3zbahkf0pcyAerMWp+9ahpPn/u05eRPMWMrS1XqRG/hpK/UfMiSmtu/hp1FMZ//1v7+KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACoWXbU1NJX7ppSiVEgkA8tkH92vz8/a48LzL4NmvlXrmv0I8ta+av2otMa/+HMsKrnr/KvlONMF9Zy2olukz18jreyxdNvufhT8JVkXxZY+Z/z1Ff0cfD3/AJE/Tv8ArlX8+HgvR5NJ8ZWUci7f39f0HfD8Y8Haf/1yr8u8I6TjVqp+R9rx9VVTkmjtty5206o0X+KpK/fT8zkFFFFBIUUUUAFFFFABRRRQB5l8Tf8AkEf8BNfgr+0N/wAje3+8a/eX4ot/xJd3sa/Bj9oJt3jB/qa/A/GCWkUfp/AEf3z9D0/9k2za71j/AIFX7feDYfJ0VFr8X/2NV3awcf3jX7W+GwF0tK9fwigvqbfqcHHkv9raN+ms22nU1l3V+yn5+OoqPdt+WnMwVc0ARv8AerhfE3xA0PwnC8upHhOvNeOftJfHDTfhD4V/to3awsAe/pX8nX7Xn/BWL4iP4ol0Hw3JLcW0jEbkbivoMm4erZhK0VoeLmmc08GrPc/qK8Qft0/B/wAOu0N/JyjbfvD/AArm2/4KJfA+Zdscv/kQf4V/DbqX7RXxc+JVw8lhZ3E5dt3ynNVf+Eq+Olov2iTSboL/AHv8mvuo+H9NL3pa+p8pPjCq9kfbf/BY74reHfjB8Xk1jwu2YlnLdc9jXzB+wnuXxqFP/PUV8w+Nte8Sa5dNN4mheGX+69fUX7DP/I+f9tR/Kvt/qSwuVulfZHyXt3VxXtH1Z/cx+zHqUek/BsXkv3Rt/lX85X/Bar4sa9qHiaPT/DdxsWR1Sv6Nf2YdHh1z4ODT5fuvt/lXzz8fP+CZvw1+OmsRatrRg3o4f5hnp+FfjWVY+jg8Y6tU/SszwdXE4aMKR/M//wAEqf2e/E3iL43J4g8VRebbTOrdK/t08F+FNN8I6b/Z+mp5Sf3a+VfgP+xf4P8AgbLDNopi/c427Rjp+FfbirurHiPOvr1bmWx1ZFlX1Ol7+43p+Ffnb/wUS+J0Pgn4Iz30L7HG7+VfoTqM4tbGabpsQt+Qr+WD/gqV+022saRf/D/7R93d8ufXiubh/AvFYuKW1zXPMWsNh2+5/O78XvH118XvFiTSSea8kp21T8SfBnxJ4R0OHWtSTEMyb14xxXH/AAZ8NahqnxP0Wxt4WeKa6AZlr+qH49fsW6T4g/Z30G8jhV5JbDc3Hua/c8zzSnlvsqC2Z+UUMFPFc0l0P5qP2WfFUng3436frVw+Io2/qK/vb/Y3+NWl/Fbw7B9gk3+XCO+egr+AL4uaC/wn8fPp9uuwx5/Q1/SV/wAETPjxNe6W9rrE3l/KyruNfNcbYBYjDLFQ6I9vhnGexxPsp7M/qa3rTqx9LvI9QsYrqM7letVWJr8TlKzsfqvMuh5741+ImheBo/O1g4HXrivBbz9sb4W2c5hlflf9oV8Zf8FSPiZqngHQxLp+7/VBuK/kx8eftmePIfFE1vGJdq+9fb5Fwq8fS9qfK5vxA8LV5Ej/AECPhz8UPDvxMsf7Q0Fspt3dc16cycfLX4g/8EX/AIpax8TPhXJfasG3C3DfN9RX7eb2r5jM8H9UxM6PY93LcV9Zoxq9zJ1jVrfRbFr66+4lfPOu/tVfDnw5MY75/mXj7wrrP2htQk0v4Z3d5D1X/A1/Gj+2x+1R4s8Ha9Nb6fv4f+E+9etkGR/2jLkR5mc5s8JZo/sZ8B/tKeAfiFqX9l6K+Zen3ga6v45Nu+GOpH/Yr+Pn/gk1+1l4y+IXx8XQtSV9nmxr8xr+vT4wTSTfCvUWk/uUZvkzy7ExpMvLczeMpTmz+Hv/AIKIbf7au/8Arqf5189/8E6fF2l+AP2ibbxBrjf6Ou326GvoH/goj/yHbn/rr/WvzW8J3mpaXqAvNGRpJv7q9a/asroe3ytUu6Py7EVPZ4pz8z/QYs/+ChHwRsoVjZ/4R/y0H+FdBpf7fXwZ1qTy7V/m/wCug/wr+Ef/AITT43X/AO8i0q6K/wCfer2n/GT4weB5PtV9YXEK/e3Nx/7NXxj4BpvaWvqfUQ4uqrTl0P8ARI8H/Erw/wCNLMX2ktlD716Un3a/hb/Zn/4KyfFjw34utfCepefFZnG5mbj+df1j/ss/tL6X8Z9JiuPtyzP5QLc98V8NnfDWJy6XvrQ+nyvPaOK06n26zba5HxB4w0nw7bvdX7bVTrzXTRyLMoZDkGvyt/bq+K3iDwT4R1R9HR3dFO3FeNg8K8RUVM9bG1/YUuc+k/EX7anwn8MyGPUH5H+0P8K4pv8Agol8D4/lZ/8AyIP8K/iJ8bftQfGrxt4kv7VrG4YJOyrz6H61xf8AwnPxmk/eNptxtr9No8ARkvel+J8PU4uqp+5E/vN0D9uz4QeI50t7F/mkO1fnH+FfUvhzxto/imFJtPOVk+7zX+dXo/7SnxM+Ht2lzNBPE8P3VY1+n/7Iv/BWz4i/22mi+IpJYYYnCKzNxiuDM+AatOnzUnc6sHxapztWVj+0Td83vUqtur5r/Z1+Mdh8WPBMfiA3KySPj9a+hrq6jtbV7pzhEXcWr88q0pU5OnPdH2sKkZwVSOxdZ1XrXz38QP2ifAfw9uGttcfDJ/tYr4J/bu/bvh+BnhGW88I3vm3iKcohweK/lW+MX/BST4pfFbVne+89mlz/ABf/AF6+ryLhOvjlzvRHzGacSU8NP2cdWf2Uzf8ABRD4IQyGFn+YcffH+FdH4d/bo+D/AIkvFsdPf52/2x/hX8Fa/Fb4iahIbqG2lO/5q2PDv7UvxA8A6l9uhSUSp7+lfV1fD1W9yWvqeHDjKpfVH+jJ4X8Y6V4vt/tOltlfvV2H3Vr+P/8AYs/4KneN7jULHw/rk0sK3LCNtzV/Vp8M/HWm+NPCdhq8M6ySXEQZq/Ps4yStgKnLUR9hlmb0sZDTc9Ibn5u1YmreIrHRYWmuvuqu6vDP2o/ile/CH4T3njLTiwlt/u7fpmv5I/jB/wAFovjBcahdaXp5uHRXZPvdgcetXlPDuJx/8JaGeZZ1Rwmk9z+sDxR+138L/Ccrw6k2CnX5hXmM/wDwUO+CNtJhpP8AyIP8K/iZ8YftwfFD4hTPNJFO7yfw5ryuX4sfFa8/efYZz/n6193T8PbL35fifLz4xqfZR/ehpP7fXwZ1iQQ2r8sdv3x/hX0d4P8Ai54Y8ZRpJpLZD+9f52Ok/tCfEbwjILm6hni2/N8xr7s/Zl/4KqfE7QfF0Oi6g08dsmPmZ+P51y4/gCUKbnSdzfC8XJytVR/d5RXwv+yN+05p/wAcPDf9pXl4rvsB+Y5r7iimWSPzFORX5zXw9ShUcKi1R9rQrxqxU47DWdd1cJ4u+Ieh+DY2fVmxsX1xXmn7Q3xd034X+ALvxBHcqk0P3V79K/kj/a8/4KvfEa+1abSdFeWZC5ThvfFerk+Q4jMZ2prQ8zNM3pYNW6n9Qmtft6fBvQ7p7O7f50+98wrFtf8Agol8Dbu6FrE/zv8A7Y/wr+GjUvj58VPHFyb+G1nleb3/APr1zJ+J/wAWNBvF1K6sLiPy/wCJv/1193HgCNtZa+p8k+MKt9Ef6JPw++O3g34kY/sFt273zXt0TqyeYtfwAfBL/gqB8UvhVqEFvp/ngbwjbW9Tg1/Wj+xv+2Npvxm8H2M2pX6m9m+8jHJr5jPuFa2AXM9j38r4jpYqXJLRn6Zb1o3rUO7dz1or42Mna59JzH//1/7+KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACmMpZqfUbbt3FBUSSvOPiVo41zw+bMDOc16PVe4t1uI/LesMVR9rSlHuaUavLJTXQ/D/wCIfhf/AIRn4lWFvt25uK/Y74fSf8Ubp27/AJ5Cvz+/aI8E3k3xQsLqxT5FuP6Gv0F8C27W/hWxhk4IiFflfBeXvB5niYNaXPq8/wAX9YwtF31Oy8z/AD/kVJTNq7sU+v1s+OCiiigAooooAKKKKACiiigDyr4rf8gb/gJr8GP2gv8AkbT/ALxr94vi2wGg/nX4MfHxt3ix/wDeNfgHjDLWJ+qeH0f3rPoH9imP/idP/vGv2m0D/kHJX4v/ALEsLTa25H941+0eiqy2IVq+g8Jo/wCwfNnj8d/79M16azbadTWXdX6+fBhu+XcaydavPselXN0f+WSFvyrS5+7XD/EieS18C6tcR/eW1c/pTgrySM5ytBs/mN/4KzftEXWreEbrwzpNy0UsSsvynmv5hfhnourfEjx5ZeE7h3mnu22qzda+5v26viRrmtfFzWtFuHzGjlVrW/YP+G+max8VNH1e5TLo4r+gcqUcBlvtLan4/jKjxmLsfuR+xf8A8Esbvwpp9rr3iS1+0pcxiVfMH94V+j2vfsG+E7zQ/scWkwB+fmxX6DfDfT4bHwTpUMPa1jX9K7Wb7lfjeNz3E1azlzH6NhcmoU6VmtT+Az/gqV8FYfgr8TBo9tCsIacrtX8a8a/YSOfHGf8ApqK+8f8AgvNJ5fxwiH/T0/8AI18H/sJ7f+E2Df8ATUV+z5fN1Mm5572PzTE01DHNLuf3cfsjf8ksj/4D/KvqJ/u18ufshf8AJLYv+Afyr6lkT0r8Fxn8eR+x4b+FAn+Xb7UituqPd8u2mtMsUe5/u1yG0pHh3xu+Jtj4A8P3bXW35rdvve4Nf5/v7dXxTvPEnx21WUXDGE/dXt1Nf1P/APBXD47x/DzQPLtZtheIDr61/Gd461D/AITvxpNq332lr9g4By1Qi8RNH5txbjOeqqMeh+pf/BN39nuT4napp3ihYd62zB84r+zGP4Y2+tfDDTPD80KnyLXZt/OvwW/4I3Xnw78G/Ddz4qfyphANvTrkV+88X7SnwqtbcW0d18qLt7V81xdjK2IxjUE7JntcOYalSw15Pc/hy/4KTfB+88OfHa6mjRkjG7tx1rJ/Yd/aFj+DfiSz01pdnnTBPzNfsf8A8FINJ+Fvi7SdQ8Vaad9zztbiv5cvDd3fWHjq0uI+FjvAfwD1+lZTW+v5b7KottD4jMIfVsW5QZ/pefs7+LI/F3wn0vWlOfOSvdEb+Gvxi/4JzfHi38TeCdH8L+dl41C7c1+zNfhOZYV0a8oH6tluL9rRhI/Cz/gsN/yL6/8AXIV/Gl42ijbxPMxFf2Wf8Fif+RfH/XJa/jU8bf8AI0zV+x8C/wC6SPzviz/ej+wr/ghCqr8H5tv/AD6r/wChLX78ydq/Aj/ghJ/yRyb/AK9R/wChLX76/N71+WcS/wC/1PU++yGP+ww9D59/ac/5JLefX+hr+Ef9vxd3iSf/AK6/1r+7r9ppS3wovF/z0Nfwl/t+I0fiabd/z1/rX1/h9L98fM8Y7RPRf+CKtjt/aaEm3/lrHX9xvxmiX/hWOoKv9yv4g/8Agi5IqftIozf89Y/51/bx8ZJlb4X6iy/3Ky47/wCRhH5GnCzvQmfw/wD/AAUSt/J1i6Y/89P618i/sL+GYfid8drfwjIiyZ2/L9TX1n/wUUmlbWrtW/v/ANa8O/4JZ2/l/tUWtwv3v3f86+8w0qiyi8Ox8bOEZYxqXc/rw8E/8E+/Den6b5d1pUTkj+IV89/tNf8ABMSPx3oP2Tw7ZLA+w/NGK/dTw/MZLMM390VeuoVuo2jb+6a/FlneJp1ubmP055Nh6lGyR/mp/tJfCfUvgb8RpvCbboriPPPfg1+qv/BKf9prUPhzcJpOvXRm85ii7z6msT/gqR8PdNj+Lt7rCp843fzr82/2dvFk3h7x5psML4zdKv61+zTcMxyu8lrY/M4QlhMXa/U/0avhr4gXxP4Ls9cj+ZZl3V8w/tDfs733xWsbm1hDMJs16d+yneNffA3RLpv40p3xa/aI8A/DOwuP7cufKli+lfhtONSnXapb3P1mp7OpQTq7WPx78F/8Eom0XWJ9R1C1V/Mcv82O9e8S/wDBOXQTZ/ZzYRbvoK8C+NH/AAVC8B2lxND4f1L5kbb1FfDXif8A4KpaqshXT9Q/8er7KlhM2xCUm7Hyzr5bSukrncftdf8ABKXWJNLv/F2kJ5UNmplZUxjFfzN+KNN1LwT4yvNFs5WiltJdjMvtX7+at/wUovvFXgPUtH1a/wAvcwbOtfgv4+1CHWPFl9rGc/aJd+6v0PhaOKSlTxR8dnE6Dqp0dj+o3/gl3+01Iug2Hgu+uGeV9v3utfv/APGj4lWvhH4f300rKGazLKfqlfxw/wDBNXXGT4oaZaBvl4/mK/ow/b28XXeieDzb2zYV7NV/NBX5zxFl8P7TStuz7TJsbJYCUr7H8iP7Zfx61rxn8VtY0ma8d4Q5CpniqX7NX7J2vfGjXLWaxDlJGHSvmT45O118SNSuv42ev6wP+COfwb0XXPhXD4iuo8zRLG27FfpGc4z+zMuUqR8XgMN9dxVpFHwL/wAEi9Yt9BhmuoGPmwZ+Yeor84f20P8AgmT4m+C3hufx9OHEAzwenHNf20WMC2tjFar0RQtflP8A8FcrWFv2aZ27/vP5CvzLJuJ8VUxcYze7Ptc4yHDUsM501sfwm/DXxBfWXj7S7qxmaJY5x92v7hv+Cc/xSuvFWj6Xpc0zPsQLzX8NHgeNV8YWKf8ATev7K/8Aglj/AKyy/CvtuP6Snhou2p87wtNrE2R92f8ABTNpo/2X9WkhO0//AFjX+eDYrcah4mubW4bez3Ug+b/fNf6IX/BTNl/4Zg1dW/z8hr/PL0fy/wDhNHx/z+N/6Gaz8OI/7LL1N+LZfvkvI/Xr9jX9hXWPixrEEiozpIw+Wv290n/glDPa2nkzWeT9K8e/4JUzM2rWEZ/vLX9NbMwavlOI88xVLFOKke3keT4ephlUqLU/lY/aG/4I7+Jtc02W80WJ4fJQv+7A7DNfzW/GL4d6l8HfHlz4RkZkuLb+LvX+mx4oto7nQb5ZP+fd/wD0A1/Ar/wUQ8L6ba/HDVbyMfP/APXNe/wTn9bE1XSqu54/E2Uww9qtI+vv+CWP7SF94Phs/DepXbOZsJ8xr+yDwXqg1TwbZan/AM9IN1f56v7GurXVj8RtEt4Tw04Wv7+fhPeLH8IdGmk/itP8a8HjvAKliFJdT2OEcS3RafQ/ni/4KgftKSafb6h4Lt7nY53fdNfy5eDfC+q+PvF0Nrcu0zXFxt+b3Nfdf/BU74ha4/7S15o8b/ufm/nXl/7JereCdE1611DxYdmyUP8ArX6DkmF+pZZz0177Vz5DM8R9YxTUnofvt+yb/wAEwbq48J6d4q1K282O4UN8wr1f9or/AIJlpL4Hv9Q0+yVCq/LtFfXvwV/4KBfs5+GPhvp+jSajteFNvUV2ni7/AIKHfs0614dn02bUOJF9R/jX5pUxuaPE+0s9z7Cnhsv9jyNrY/hp+OXwD1r4M69c/wBob1VZTt3fWvsv/gmj8eNe0H43Wum3V85tl2fIx4616D/wVK+I3wn8bSfafhvN5rFlZun49K/PH9lPVW8P/EqHUImw42/zr9Uj7TG5a3WWtj4bmVDE/unpc/0gPh542t/Gmm/arfb90HivRvLz1r88f+Cf3i648WeBzdXD7/3IP6iv0Ur+ecXS9lWcT9hwlX2lCMz/0P7+KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAprNtp1NZd1AHj/i7wbHrWsRXzBfkbdXpGlxfZbOK3/hRdtXmhjZtzLQsXZa8yjl8adaVVbs6HiHOKi+hJVio1X+I1JXpRMJSCiiimIKKKKACiiigAooooA8n+LK7tDx7GvwX+Py7fFxX/AGjX71/Fb/kDf8BNfgx+0F/yNp/3jX4F4xbwP1Tw+/iH0z+wn/yGn/3jX7L2H/HstfjP+wn/AMhx/qa/Ziw/49lr6Lwm/wCRd82eLxz/AL/MuU1m206mtt/ir9bPhSPb8u6uC+KKlvh7rOP+fOT+Vd+zZXiuP8cW7XXg7VLXu9tIv5itKU0pJsxrK6aR/nO/tkLcf8L4155EYDzTX1N/wT8163tfiLpFqzqrM4q1/wAFB/gvfeHfH2reJGRlSVy3Svj/APZG8YTaD8a9ElaXCLL8y1/Q0ksZlfLS7fofjMG8Pi/f7n+jp4FZZPBulyL3t1/lXTSthdteD/AX4had4u8D6TFafeS1jH6V7NrWpR6TZ/apvu1/PtSm1VcWfskKinS50fxQ/wDBer/kucX/AF9H+TV8K/sI/wDI6D/rqP5V9m/8F0Ncg1v42RTW/wDz8N/I18dfsEwNN42VR/z1FfvWXwayVeh+RYuX+2v1P7s/2Qv+SWxf8B/lX1Sy7q+W/wBkqIx/C+KP/d/lX1EvHXvX4Lj/AOPM/YML/BiNZdtcL8RteXw34Pu9YkOBCu7dXdM26vg/9tz4sWfhj4M63YxnZPs+Vs0YXDutVjS8zLG1/ZUp1GfzA/8ABXL43Q/E+4OnW1z5vksF2qfQ1+HuhyyaXMLiPlq774oePNY8ZeO9Qhvrhpg90wXd7mvtL9nv9gz4hfGD7PeaYjmObG3aua/o3CU6OWYOMKj0PxetOtjMQ5QWrPLfhz+2F4u+GtidN06KVVIxxXpn/DeXjqX95tn+av0Q/wCHMvxUbDNby/8AfupP+HNXxW/54S/98V4M81ymTvKx6yyzMErJM/Kvx5+1l4q8baHLo90kpWX+9Xx9HNJa3X2yVcNu3/rX9Cbf8Ea/iuP+WEv/AHxX5t/tlfsc+MP2dL5bXXEZN2PvDHWvXyrOcvk/YUGlc4MXl2KprnrJn2h/wSN+P13J8YofD99KyRI6bd3Sv7T9J1aDV4ftFq6uv+zX+bt+yh8Sl+EfxCXXJH8rDBt30r+7D9gn4sL8Vvhj/bSy+Z8iNu+tfnXHeXeyre1itD6/hHGOadGbPhH/AILITPF4fG1c/ulr+Nvxk27xNMzfLX9vX/BUj4e33jTw6WtVziIfpX8RnxksZNB8fXWmycOn+NfSeH9VSwzgt7Hk8XQaxPMf2Cf8EI2DfB6b/r1H8xX79+Z/n/Ir+Zn/AIIdfFbS/DPw1fSL7bvlgCL+Yr+lWyul1CziuofuyLur814poyp4+d11PteHaynhKaR4h+0xJt+FN4/+ehr+E79v64+0eJpv+up/nX9sv7ZXj7T/AAv8G7+a6/h/wNfwe/tSfETT/iJ4muP7N/57Ffl+tfY+HeHbqubWh87xlUjpBM+of+CL6mf9pRI/+msdf3A/GO3+z/C3Ul/2K/jP/wCCMPgW+sf2gItUk+4ZY6/tE+NUPnfDXUYh3WvP46rJ5ikvI6uFqf8AsspH8MP/AAUR/wCQ5df75/nXlP8AwS1/5Octf+Af+hmvaP8AgpDpM1jrFzJJ3f8ArXhX/BMS8jsf2lrWaT7v7v8A9DNfoOCd8oduzPjav++fM/0MvDv/AB5r/uit9m2oc/3a43wLqkOqaeJI/wC7UfjrxhZ+D9PN3ffd2mvwKrBuq0j9gpzSpKbP47/+Cp2vQ/8ACyr6zyu75v51+MPwls7ub4iaU1ujH/TFb5f9+vuD/gpj8Tode+PF3Hbv8nzfzrkf2J/hu3jbxVZX2zfsnDfka/e8sh9Wyrnqdj8gx79vjHbuf21fs4+Il8K/s26DeXLbP3R+9X8sX/BVL9sLXF+Jk/hPT5H8qYsu5DxX9JfjCzvvD/7NOlWlizRFIjX8Vf7eX2u6+KLyXzb33t8zV8ZwbgaWIxcqk1fc+o4jxNSnRp0ltocX+z38C9U+PmvFA8r+dKd3zHvX7qfC/wD4IVaP4y8Pw6xfXex5f4WkIr49/wCCPuueF9B8Uv8A8JJCswLtt3V/ah8MZtJvfCsN3pMSpEfugV18W8QYrB13SpaJHFw9k1HFU+eZ/MV8TP8AghboPgrwjqHiSG8XdZxF/wDWGv5yPil4IXwX4sv/AA6pz9jlKV/ovftNeKtN0f4S6/b3Srk2p/mK/wA839oLWrfUvixrph73Rrv4JzTF41y9s7pHHxHllHCtKkfd3/BN0bfjJpi/T+Yr+ij/AIKNQzSeFEaMM3+hx/8AoAr+ef8A4Ju2MjfGDTJR04/mK/qe/bG+G1x4s8Ay3cI3CKyDfklePxNWjHNIs9LJabngKiP4FfjJM0Pjq/z/AH6/tQ/4Il3VrJ+z6PMZQdkdfxk/tBaf9n+LGr6Wo5jl21/RF/wSj/ax8P8Aw98M2nw/vnXzplVfmPpX1nF9CeJy6PJ5HiZBXjRxadQ/raboMV+Tn/BXH/k2m4/7afyr9O/DuvW+s6RbX8PSWIN+dfl7/wAFbryNv2a7mP8AiHmfyFfjuSQax1PTqfome1YPCSd+h/CH4J/5HCx/661/ZL/wSx/4+LH8K/ja8E/8jhY/9da/so/4Jaf8fFj+Ffr/AB5/uiPgeFf96R9zf8FMnP8Awy/rBP8Ang1/nn+H/wDkcn/6+3/9DNf6GH/BTD/k2DWP89jX+ef4fTd4ylb/AKfG/wDQzXD4c/7rL1Onir/eUf1rf8EqP+Q1YfVa/pwf71fzH/8ABKj/AJDVh9Vr+nB/vV+ecWf74fZcPf7ojI13/kB33/Xu/wD6Ca/gv/4KN/8AJZtV/wA9zX96PiBf+JDet/07v/6Aa/gu/wCCjf8AyWbVf89zXseH/wDvTOHjX+BA+fP2Q23fE7Qv+vkfyr+/T4dqzfBvRNv/AD5/41/AL+x4u34m6H/18D+Rr/QV+EMSS/B/RFZc/wCif416PiDO1amzzuEIXpSR/AN/wU6g/wCMpLxm/wBv+dfHel2OqXhVdNid2/2K/Sr/AIKnfC3Vh+0Lea9GG8r5+3vXzx+yt438C+GfEdnY+MLZLjfOE+Y+9fomCxKWX06kFeyPi8bTviXCWmp5fpfw++K15GrRWF+U/h278VZm+G/xbWby/wCztR2/8Dr+5v8AZq+EP7O/jr4b6XfR6DA8sifer6bb9k/4Cs25tAgr88r8bKnUadM+tw/CbqU1JVEf52OsfBv4oXKhptKvX/3lJr1D4B/A/wAfN44i87R7qIcfeU1/fpd/sr/AOGEySeH4NqLuryXQ/Bf7N9v4uOg6bocCXKY5U0Pj6U6ThGmw/wBUlTkr1EcB/wAE5PDN94X8Atb30LRHyR976iv0nrn9B8NaL4dh8nQ4VgT7uBXQV+Z4zEe1qup3Pu8LR9lSVPsf/9H+/iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAG7FoVdtOooAKKKKACiiigAooooAKKKKACiiigDyr4rf8gb/AICa/BT9oX/kbm+pr97viku/R8f7Jr8F/wBoSML4uf8A3jX4F4wq/Kz9R4A/itH0l+wfu/tp8/3jX7OWH/HstfjP+wnxrT/7xr9mLD/j2WvovCb/AJF3zZ43HCtj5lyiiiv1s+HIdvzbar3lrHc2r2rdJF21eopcqA/n/wD+CtX7LcmrfC2XV/Btt9ovJEZtqiv455NJ8ZfCPxFHeatA1td25+VfcV/pu+NfCOn+MNO/s+/hSZP7rgGv59v2zP8AgkD/AMLa16bxjpKrborFtqMF6+1fp/CfFdPDU/YV9j4DiLIKk6ntaKPxM+Av/BUL4weC40sjMwSFdi/vD2r23xt/wV0+MWoaT9ntrlmP++a8z8Vf8EpfE3hm6lSFpeG2/KxrF0P/AIJi+Kr688mQzf8AAia+sayapL2rsfOxnj4Q5Fc+E/jN8ZvF37Q+vLq/iZmkumfKrnPJr9Qv+CRv7Ovi7XPiZ9q8T2TJamdcM3PGBX0F8Ff+CLOsaxq1nr1w7BIHDsrSf0zX9IH7N37Lel/BXTLOGG2iV4VG5gBn868riPinDUsM8NhXuehkmR1qtZVay0R9HfDfwzb+EfDi6XbjCrivRE+9Vfy9vyrxU1fjMpN3mz9OhBRSSIZbiG3+aY4Ffyk/8FXv2npdB8WXngy3uPkmZl259K/qO8YeZ/Z37vd/wGv5Y/29v+CfPiL46fFRvFVrJKEZ3bbuI619Zwr9W+tKdd2R89xLKq6Ps6SP5p9P0PVPEfi5LjTIvMaa6Vm/F6/vA/4Ju/Bu00n4K6VrV1HsuON3HsK/G/8AZl/4JWX2i6tHdagrPscN859DX9SXwM8Dx/D34f2nhtQB5X+FfTcbZ/RxCVGi7pHh8L5XUhUdWqrHsTNt+SpFbdTdvUmmp96vy4/QIxBslsV+JP8AwVG/Z9h+KFpPqjw7/JTfux6Cv248z/P+RXknxa8BW/jbwvf2MiKWmgZBu9xXfluMeGrKqjjzHDfWKLp2P80b4oQr4R8eX2i2vDQvt21/U5/wSN/aFXS/ANt4ZuJ9jyKq7c18V/Hj/gkrrWvfFTVPElszqlw+7aG/+vX1B+yX+xX4g+E/iuwBefZGw3LuOK/Xs/zPA4zAKCn75+aZZhK+GxF7aH9HHxK+H+l/EnwbLNfjcz2pZeP9iv4Qf27f2b/G3hX40anrENgwsv4X/E1/oHeG7dl8NWdpJ2gCfpXwz+1F+xfpPxz8OzabDbRJNLn5+Aefevz/AIcz15dW12Z9jnuUPGU+eO5/C/8ACH9qT4gfAlUtfDbsir8vynFfoZ4N/wCCv3xyt7eO1vLhgifL/rDXsnxl/wCCLeteGb52t3dlDH7smf618k33/BM3xRazGGPz/k/uk1+pTxuUY5c1Vq7Pg40MdhHywujifjh/wUy+MnxOtZvDmoTE2s2d37wmvh/wb4L8ZfETxRa/2DbNOJpwz7fc81+o3hH/AIJM+I/FGopbSeaN/wDeav2s/Yr/AOCUsfwfWK61ZEnYfNuchq58Tn+XYCi1hbXNaGVYvGVV7VM7b/gm/wDsn2/w/wBL03xZdW/lXL4ZuPSv2+8UaTHrGhzadJyJKzfBvhex8L6Hb6Tbwonkrt+UV2X3l+avxbH5hLFV3VbP03AYKOGo+xR/In/wWW/Zw8RW9ut94Ps2mztZtvH1r+eH4e+LvEnwT8WDWrQNDfxY+XOOlf6Pnx0+BulfFvTZLS7t4nyhX5gPSv5tf2iv+CKupX3ia68XWL7I5P4Fb+ma/TuFOKKEMN9VxL0Phc/yOrCt7Wktz43+GP8AwVo+Mul6f5N1cMDt/wCehrN+MH/BVX4xeItL+zrOx+X/AJ6GuX8Rf8Ev/E+jXXlxmf738LGpNH/4Jg+KPEEn2eTzf7vU19AoZLze10PI9rmHL7LU/M/xNqnir40+Lf7UMTT3k2flznrX9M3/AARp/ZR1T+z21Dx9ZtbEK0iZGfpVz9lP/gjHd+HNctfG2pHzEix8ryZ9+ma/o3+Gvwz0v4e6bHZ6fAkOxAnyADoPavmuKuLaM6LwuFeh7mQ8PVfbKtW2RU8a/DvT9U8Ix+HVGY41IWv4lf8AgqH+z7420f4vS6lpNixs0eTc9f3j4B6jNfEH7Sn7I+k/G7Rby0+zReZcKfm4B/OvkeGs8lga/PPZn0We5V9co/u90f5+Pw/+Mnir4P6h5mhsySxt83OOa/TD4a/8Fa/jp4e02LTGmYQp/wBNDX038bv+CJeteGNQudUhlYrK5dVWTPX8a+Qr/wD4Jm+JrCY2qiXj+6TX61Wx+T5h+8qtNn57ChjsLpBNGb8cP+Co/wAavGkNxpPnE29z8kn7w9K/NVbfXviFr02oaZF51zO+5vqa/Vjw3/wSz8Sa9MlrJ5v735fmJr9MP2Vf+CM914L1dNc1Q+aHcPtdgaj+3Mry6k1RauaRy/GYypeSZ13/AATH/ZRktdDsPGGrW2ydNvav6J/HHhS117wXd6bIM77Up+mKwPg38LrH4Y+FU0GKFBjH3cdq9l+Vl8s8ivxXNc0eKxLqn6ZlmXxw2H9kz+H7/goB+xH4i8OeJNS8X6DYMTMxbco9K/Jfwz408efB/W4tQ8pobmBvl5x0r/Rq+NnwU0X4q6EdLktYtxUruYCvwj+PX/BE+bx9q0usaeViXlvlkA6/jX6HkHGlF0lRxWx8Xm3DdWFTmoq5+Mfhn/grx+0NpNmmnxzOEhXYv7w9BXlvxd/4KRfGj43aK/hPxNKxtnz/ABE9a/RDVv8Aghjr2n3JUzP97/np/wDXrxv9oD/gkXqXwH+HJ+IFxPu2Z+Vpc9B6Zr6WhjcldReytzniV8LjlB+0vY/H3woqw+MrHb/z1r+yL/glf881jj2r+OPw6qx+MrBf+mtf2Pf8Esf9ZZfhXPx7L/ZY2OnheP8AtCPu7/gpmsS/sv6tub/ODX+eTpM0K+NHWNv+Xxv/AEM1/pF/tpfC+b4sfBG/8Jw7szf3Tjsa/kS03/gkP4gs/FD3zNLg3Bf73vmvD4GzbDYbCzhVlZ3PX4owVWrXUoo/TT/glSd2sWDf7S1/Tlt+XdX4r/sL/ssXnwjvbWSbd+6x94+lftUzZXivguI8VTrYlypu6Pq8jpunhVCaMfX2zoF8f+nd/wD0E1/BX/wUemj/AOF0aqc+v8zX97WqQfadLuYP+ekTD8xX8rP7Yf8AwTx1b4mfEq/1yHfib39zXtcF42lhcQ51XZHm8U4epWoRUEfh7+yHfQj4naGJD/y8Cv8AQh+CreZ8JNDK/dNqP5mv5MvgT/wTB1rwp460rWJC+22nD/er+ur4Y6Q3h7wBpWjP1toAldnHOYUcVVi6TuYcI4apQUvaKx+DP/BSz9lm48SeHdS8VaTbebc87eK/j/1Tw34w+HviF7jxFA1vJBOWT8DxX+nF8QPBOn+NfDsmi3EKP5v94Cv59f2z/wDgkf8A8LSvpNU0cLb4bf8AIwWurhLiuGGj7GvscvEGQSm/bUUfhr8Cf+Cmnxk+H8cGgWszC2tsKv7w19jt/wAFevi/95rlv+/leBeIP+CU/iTwvfSwxmU7P7prBtf+CbPiy8uBbL543e5r66cMlxD9rJo+bhVzCkvZwuel/EH/AILD/HJYzDptyx3rt++e9en/APBPf9rz4zfFz9oqH/hIlY283l/NuJ7muX8E/wDBF3xJ40lQzTSj5h96TH9a/Z39jn/gli3wD8QW3iaYqzR4/iB6fjXh5pj8po0ZUqKTZ6OCwePr1lUqN2P3OtH/AHIz/dq3H3qvHDtWpK/IY6tn6bGGiP/S/v4ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDzL4m/8gj/AICa/BX9ob/kb2/3jX78fEG2W40va1fgv+0tbrb+NHVf7xr8G8YYv2cX5n6dwBP/AGhryPoP9hP/AJDj/U1+zFh/x7LX4z/sJ/8AIcf6mv2YsP8Aj2Wve8Jv+Rd82eXxz/v8y5RRRX62fChRRRQBDIvHy1TuLG3voWt7kZDVoMu6hV20ra3G7NWZ5Vf/AAc8Bakxe6s9zH/PpVS3+BPw4tZPMhs8H8P8K9iorX21TuY/V6Zy+l+FdF0OPytPi2V0cS7eaey7qdWUrvc0UUtiFl205Nv41JTVXbRKI4xKdxax3S7ZlzXIXvw48KalJ515bbjXe0VcZNbClFPdHEaf4C8N6S26xt9ldTDbrCvlx9KvUUSm3uEYpbIYqkUiqQakoqOVFRkJgZzTJIlkQxt0NSUUxHA3nw78KX8xluLfLHrVe1+Gfg+xuFuLe2w69K9D8tf8/wD66Ty/8/5NVGcrWuR7OF9iGCNYVEa9BUm35ttSKu2jb826plqVyo5TWvBega6xfUot+a4eT4F/DWZzJJZ8n6f4V7LTPLX/AD/+urjVmtmZunF7o8v0/wCEPgTS5BLY2m1h/n0r0Ky0+3s1224wBV7y1/z/APrpVXbSlNvdlRglshrr/FQq/wARqSio5UWNZflwKxdT8P6ZqsPlXybxW5TWXdTjdO6E4p7nkM/wR+Hl6265s8n8P8Kda/BH4d2LeZbWmD+H+FeuKu2hl3Vr7epbcj2NO+xlabpVlpNr9m09dqf3a0NpYcVKq7adWNtbl8q6Ffy9q05V3VIy7qFXbSlErliczrnhPRdfXbqke+uAm+Bfw7uG8ySz5/CvZWXdRt+XbWkKlSOzM/ZU3ujyWy+C/gKxkWS1s8EfSvRLDRbDS4xHbLtUVrKu2hl3UpznPdjVOK2RDUNxcLb273DfdRd1TVj69Gx0O6Vf+eRqOVbBKNj5L+LH7afwt+Dsctx4nfCxZ3fMB0rxHS/+Cp37OeuWu+N9w/66j/Cvxv8A+Co3gnxVqmk3n9m2by/e+7X87Om2fxL8Pr9lGmzha/VMn4OwuMwqrOVn6n5/juIMThq7glof3YX3/BRb9meWN2k+Y7T/AMtR/hX5G/8ABQb9vr4T/Ez4Z3Pg3wnJ+9+bavmA9R9K/nja++Ikke37DL8y15jqvw9+KmrTm4sNIuJXP90V9DgeDsLg6iqzlt5nj4ziHEYqn7KyVzN8FtNdfEPS7PvJcbVr+4D/AIJo/DvV/DumaZql4PkkUMvFfzm/sG/sJ+KPiRrmm+KPGmlvA9u4l/ejvX9tXwP+GFj4B8F6ZZW4VTDEFrweOM8pVVGjS6HrcLZZU9p7WSPbNR0+31KA292Moa4b/hVngzzPM+zc16SvK03y/wDP+TX5WpyXws/Q3CL3Rzem+F9H0nDWEWyugqbb8u2lAA6VMtdxKCWxA67l2n+KuJ1D4e+F9Sna5vLfLNXfU1l3U4yad0Dgnuef2fw18I2cgmt7fDJXbwwiKNYY+gqyq7aFXbT529xqEFsiGqN9pVrqAMd0m5TWtRS63Bx05Tyi9+DfgHUmMl1a5Y/T/CqEfwG+GsL+Ytn8w+n+Feybfm3Ubfm3Vr7epblTJ9lT7HF6V8P/AA1o/wDx4Q7K6yK3WFfLQVaorLmb3Y4xS2RDsajY1TUUFR0P/9P+/iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAOJ8b/8AIOr8F/2of+R4b/eNfvp4rt/tFjtr8Ff2qrf7P48df9o1+GeMUP3MX5n6X4fS/wBqfoe4fsJ/8hx/qa/Ziw/49lr8Y/2F5Vj1p8/3jX7MaZIslqGWvY8JZf8ACd82edxz/v8AM0KKKK/Wz4UKKKKACio13buakoKkFFNZttV1k+alzIktUVH+8pWfHSmA+iq9UbrVLe1bbMaA06mtRVOGXzoxIv3TVgP60FcrJKKZ5i/5/wD1UeYv+f8A9VLmRI+im71p1MAoqNm/hFN3tQVysmoqFW21NQHKwoopnmL/AJ//AFUpSJH0VC0n4VNRzIAoqPzP8/5FNZt1OOopSJqKh3tRvaguJNRUO9qcJP71BJJRULNuqreahDZrulOKXMgNCis+G6W4j8yJvlq5Ge1MI6klFFFABRUIZulG9qXMgJqKh3tQrbaYS0HGP0qGaHzIXjPORipGbdUafdqZFSPkj4xfs56X8RrN7Wa0SXfn7wr8/vEH/BMmz1GfzLewQf7or9uqn/h+WvSw2a16KtCR5tbLMNX1mj8FF/4JZssgP2NcfSvob4b/APBPnwz4ZuEk1bSopVGPvCv1fbd+NKu3+KuqtnuKqKzkc9LKMNB3UTyHwL8HfA/g23WHTNKgt9q/wivWlhWGNY4xgCrC7f4aGXdXjVJzm7tnrU4RhokInSn1D8y/LTmb+EUjSRJRUKttpWZg1LmRJLRVegH0pi5kWKKhVttSb1pcyGOoqFj830pwf1pi5kSUUxnx0pm9qA5kTUU3etNL+lLmQySio4+9SUwP/9T+/iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAMfWF3QV+Av7Y9xJH8SDHj+Jq/oKuFV12tX4J/to28P/AAsh/l/iavxbxhh/slOXmfonh9P/AGxryOy/Yll/4nDN0+Y1+1Ggf8g5K/Ev9jNsawQv941+13hpt2lpXR4ST/2G3mzDjuP+2s6Ciiiv2E+CCqN9dC2spbr+4pb8qvVh+I/l0K8P/TJv5U1uKR+XH7TX7c3iD4Q28z6LE8zxZ+VBnpX59W//AAVz+Nl6vmWui3rr/sxV6V8UNNt/E3xCvdP1JPOi3fdav0M/Zx/Zv+EeoeEfO1LR4pX2j5mr63/ZcNRTqwuz5RTxWIqtU6lkfkDr/wDwV/8Aj9YXUMMOgX5V3VW/depr9oP2X/2hvFnxc8K2usa7aywSzfeDjBr16X9lT4F3DBptBgOPmFer+H/AHhfwraJZ6HarbxJ91Vry8fjcNUp2owsz0MFg8VTqudWpdHcp92mydqjjbatfOvx8/aK8NfATRxrHiLbsZd3zHFeRh6MqjUIK7ParVI01ebsfQ3mNX4t/8FEv24PEn7N3j7TPD+jxO6XdxEjbBnhsV0V9/wAFe/gvazeW3kf99V+MP7fX7ZHw3/aE+KGiXGjoj4vIfunPQivqMoyOs669rDQ+TzrOKf1f91LU/qj/AGdfiNefEj4aab4mvAwe5Tc24V9Cuv8AFXyj+x19nm+BWiTWwwClfUGoXiafYvcydEr5/GLlquEV1Po8BJuipTZex/tf5/Oo6+B/j1+3t8O/gKm7xDs7febFfL7f8Fj/AIKKnnfuNv8A10rejlOKqLmjFtGVbNMNB2nLU/ZyL7lN+Xd7V+TPh3/grB8H9e097628rai7vvVzd5/wV++CtvMbc+RlOPvVX9j4pu3s2RLNsKlfnP2IprNtr8s/hn/wVJ+EfxL8UQ+FdL8rzpvu7Wr9ONN1KHVreO7i+7Iob865cTgauH/ixsdOGxtKu/clc1g25acrbaFXdXgPxU+PXh34W2M15q23bD97ccVzQoyqO0TorVo01zzeh9ACT1qOvyCuv+Cufwbtb6W0byMxsQ3zeleg/DH/AIKefCf4meIh4Z0vyvObH3X9a9GeUYlK7ps86Gb4abtzn6dbFqwn3a5fQPEFt4gh+02v3fvV0ysNv0ry+Szs0elFpq6Y1/vVHsWvj/4wfth+CvhHJLHrGzMWfvHHSvi+4/4LCfBW2Z8+R8mf4vT8a9SnlWJqrnpx0PPr5lhqU7OWp+yW7bz0qPduYV+Tvwf/AOCsHwf+Lnij/hF9HWLzlYL8retfp94V8TWfiqz+22fSubE4Orh3arE2wuNpYhXpSudWnWkf71BLRrurwX4xfHjw78IdBfXta27Ez9446VhCE5vljudFapGEeeex7xX5Z/8ABSz9rDWv2YfBUWuaOjuzxb/kGe5rh5f+CuXwb3bR5H/fVflh/wAFNP26Phr8fvBMOj6OiO4ix8rZ7mvpMpyOtLExU6eh8xmmd0XRkqUtT+gP9iP43al8dvhDD4w1JGEj7fvD1Ffaka7RX5n/APBLe4s5v2cbaS1XC/u/5V+mSturyMypqnXlTStZnuZTOcsNGUnfQdUZfBwKkpjKWauA9CIxm3VXu7y1sYvOu3WJP7zVY24+9xXxj+3F8Tv+FW/B2bxEsvlY3fN9BWtCk6tRQXU561RUqbm+hwv7SX7Xv/CqJJodCkW4dM7VTnNfk1rX/BXT46WurTW1noV+8aNtVli4Ncx+zr4d8bftiahbeMNPuHuLOJvNdVGQQeP61+8ng39k/wCDtr4es7fWNEie5WPa7N619S44TArkqx5mfMUp4vFvnpS5Ufjb4N/4KrfG7XNUitb7RL2JD95mjr9hv2Y/jrrnxg0/7VrEDwnbu+cYrqNU/Zd+D8dqx0vRoopP7y113wu+HNn4FUx2sPljmvNx+LwlWn+6p8p6ODw+Kp1P3tS6PZlXdRvanBtqV5T8Svipo/w10G58Qapt8u3Xc2414cIybSirnsTmoK7PUqK/HDUv+CwXwXtdQn08+Rugco3zeldB8Lv+CtXwb+Jni5fB+l+V5xx91vWvUlk2KS5nTZ5sM3wrlZSP11VdtDNtrkvCniuz8T2n2qz+7t3V1cg/irzHFrRnqxmnqhu75t1Sb1r5K+LX7V3g/wCEscr6zs/d/wB446V8ZWP/AAV0+DOoaxFo8Xlb5ZREv7zvnFdkMvrVI86joc1TH0YS5b6n6+U3etcD8P8A4gab4+8OW3iHTdvl3K7l2112q6jDo+ny6hN9xK4XSafI0bQmmuc0qj8xq/P/AOMn/BQL4b/BxiutbPl+X5mxXzu3/BXj4M7fMPkbf96vTo5VXnG6iefXzbDU5Wcz9ilbd/FUrLtQ18jfs+/tYeDfj5pP9qeHduzaG+U5r60WQSW/m9itcNajUpS9nUWp3UatOrHnps/LfxZ+2V460X44J8O7ewnNs2fnC8cHHWv0d8I61PrVhFcXCsC6Bvm9xX5ueKPjX8G7X47J4XvLGJtQOfnzz1r9MNAnsprOKWzXCsgYflXdjMOoU4vlsceDrOdSScrnRMu2m1j61rUOi2/2q46V+dfxi/4KVfCv4Q683h/WvK83cV+ZsdK5sPg6td2pxudFfE0qGs5WP0sZ13VIq5Xmvxfb/gsZ8FYXCt5Byf8AnpX1J8Fv2+/hx8ZNUj0nQtm+XGNrZ611VMpxNOPNOOhhRzTDVHZT1Pv5V206q6t5nzLUzNtry27Hpbn/1f7+KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAjl+5X4M/toQyf8LGdsfLuav3nfpX4kftlWW7xo8mP4jX5F4t0faZfBroz7rgSv7PHX8jn/2QbpbfWm3N/Ea/bXwpJ5mkI1fhV+zDJ5OudcfPX7keBG3eH4jXD4QT/wBnkvU348h/tTkdlRRRX7WfnwVh6+m7Qrpf+mR/lW5WJ4ibbod4f+mTfyq4biex/PF+0JqzeFfF19qFq2H3V618Ef2kvEtj4TK27/wjvXkvx28Ot468aXukq2Pm9cV9Kfs//sb3GoeF/M87+EfxV9xXnQVBKqfG01VnWfsjrdB/ac8ZXV4sUzttZwvWv0z+HeuT694Yh1K4+89fE9n+xfNazJN5n3WDfe9K+5PBPhv/AIRfw/Fo27Oz8a+azGeHmvcPocDCqpv2pB8QdYk0LwLqWtQ8PbQl1/Ov52tS+J2tftW/ELUvh7q7edDbT+Qq5zxjP9a/oA+Ois3wh19B977Kfu/UV/N3/wAE27Ew/tZeI5NU+5/aX/LXp9xPWvQyOlFUKlbqtjzc+m3WhS6M/RjwH/wS3+DuuaKLzW4lSY4/5ZivyB/4KHfsf/D74G/FPRIfDAVV+2Q/dXHUiv69rF7Uw7bXGz/Z6V/OF/wV/aMfFrQ8sv8Ax+wfzFdeR5niamKs5OxhnGXUKeF5lE/a39j61jsvgRokMf3VSvaPiRdSWvgy8mi+8FryH9ktt3wL0Qr/AHK9W+KX/Ij3v+7XzmI1xDv3PdwkbUFbsfz4/HT4f6T8aNcex8ScoJ9vr0NfV3wx/wCCWfwL8SeC4NQvEXe//TMV4lqX/Izy/wDXx/Wv2t+Bgz8P7X/Pavo8xxdajSiqUrHjYPB0a9SXPG5/I/8AtufBHS/gD+0Jo/w58Fp/oF5e+Q+0Y4wT0/Cv2k+En/BMX4K+Lvh5pHiTVEXz7y3Dv+7HWvzh/wCCqniKHTf2w/DlqyKd2qen+w9f0nfs+TfaPg34ek/vWo/mavM8fWhhaU4y1ZxZfg6TxVSnNaI/Dv4ifsg+C/gL4oPirwum1rbO1sYr9Iv2Hfi9q3xKsXi1Js+SpVec/d4rl/2yYYx4TvSR83/668f/AOCWsjNDebjn5pf5mufEznXwbq1NWjqwlONLGKNPY/Yu8vrexj824bAr+Xr9tb4v/ETXv2pLH4b6ejPpV5OyO2e30r+kz4nNMuiN5O7O0/dr+eD4oRWLftQaU10E83zW+/jPWscigk3N66G2ettKCdtT7i8Cf8Ex/g3r/h+11zVI1E13AJX/AHY6kZr5w/a6/ZB8I/ss/Dub4j/DlP8ATYt23C7fujI5r96PBfkr4R03y8bfs69PpXwp/wAFK2sz+z7cLIyf8tPvY9KzwuZ154pQm9GxY3KaUMM3DdLc+fv+CR/x48afGT4czah443CRIAy7jnuK/ZRjuhLf7Jr8H/8Agj35a/Dp/s/3fIHT6iv3aVmW0/4Ca5c8goYqVjqyKo3ho87P5W/2jfE9542/a8Hw51b/AI8Zt27/AL7A6V+kmgf8EufgPrmhi7kVS80Qdv3Y6kZr8t/i9b/8Z6W8mf8Anp/6GK/pw+FimTQbXPzfuF/lXtZnjKmHow9k7aHk5bhqeIr1PaK+p/O3+0x+yD4R/ZE0+Tx94GTZPy24Db0r9Zv+CbfxI1j4j/CJdW1c5fYvfPWvH/8AgrlDHH8DyyhQfKkrQ/4JHu3/AAosf7kdZYqbrZf7WW9y8HQWHx7jT2sfrBqlx9n0u5uP7kTN+Qr+af4wfHTUvi58erz4NXb77dcfLnPUkdPwr+knxLuXw7f8f8u8v/oBr+Oz4apff8PKr/7UH8n5PvA4/wBYa5siowftKnVI7OIKr9yHRs/ZD4W/8ExfhTqml+dr0Ko+3d/qxX50/wDBUr9iX4c/BLwLDq3hVF8wxZ4UDua/qisUs/JH2XZt2/w1+HP/AAWwuhb/AAvg7/uD/M10ZLmeJnjorm6nNmmV4anhG0tT6s/4Ja2a2f7N9tGo/wCef8q/S9Otfm5/wTFuPN/Z1gYf9M/5V+kada8bNFJ4yo33Pdyqyw0UuxLRRTW5WvMO4azLtNflf/wVAxqXwDubOb7nz/yr9TGX+Gvy3/4Kk282n/s93F9GjO37z5Rz2FeplFvrMJPueZm13hpnzX/wRG0e3034UzR23T7OP5iv2I+J3iabwvpv2iFsfLX4x/8ABEXxVb3HwsmjvmWB2txtV/lPUetftF8RvA//AAnWmi3hfqu3cprozmK+vT59rnLlLvg0qe5+e/jr9q7UPDEzzXdxsjT3r6A/Zb/aI0n4yW7yWdz52zP6V8H/ALbH7Iupab8KdR8RQzsmz+7J7V8//wDBGfS9S0mG+jvLh5dryr87E/xmvRlgsNVwkqsXqjz1jsTSxUaVTqf0iK25Q1eWfE7wJ4b8XeGbnT/EZxbSL87YzXp9mu63Br8s/wBqj9sL/hEdel+GUYw9yxXcq+nvXz2Fw9SpU5KfQ+hxlanTpc8zwvXv2Mv2KbHUrm61TUESSVyW/djqfxr45+PXwb/Zd+AuhS+PvhbfpJqSZ27VC9OnOa9Y8P8A7J/ir9oa7e7tNQuIlmYv8spX+tfP/wC2Z/wT18TfCX4TyeJr7Up5VG75WmLdB6Zr7HC1F7aNOpVbv0PjsVScqTnCklbqfqR/wSo+NOt/GH4cyalrT5dYQ3XPcV+tkjHyzjng1+Bf/BDuNofhLKu7P+jj+Yr98sfuSf8AZNfOZ7SjTxsox2ufS5JWlUwsXM/mV/aU8Rap40/aSPgHUF/0Obdu/MDpX2h8Jv8Agmj8G9Qa21y6RfNjxL/qx1618X/FhF/4bOh/4H/6Gtf0IfCtVXRYP+uQ/lXo5liqlKjGNLS6PMy/Dxq4mTn0Z0fgfwPpfgfQrfQdM/1NuuF7V4j+1d46bwv8H9Wm01/9KRPkWvqdVG6vzo/bBtbiTw3fs27y9p+leFg/3lZOoe7jf3eHagfiz+xp4D1P9sL4garpvxWh/cQ3Uqpu+bhScV+tMf8AwSr+BbWu2RF3f9cxXzv/AMEvYdNXxrqPkrED58v3ce9fuwzD7te3nGYVqWI5KTsjw8qy2jUo+0q6tnzD8Df2YPBHwN03+zfDIUJt29MV9PKqpbmNeymmxqtTSAFGb/ZNfN1atSpPmnufS0aFOlDkgfyp/Ey81Bf29YI1HyfN/wChiv6cvAn/ACBrX/rgv8q/m3+JKQ/8NyW/3d25v/QxX9JXgT/kDW3/AFwX+VfTZ1L9xT9D5/KI/v5ep53+0DqtxpfhXzrf7201/PP48+CeifF74xWv/CQDIlc7uM1/Qd+0Zb/aPCO3/ZNfkT4fto4fixYL/t0smquMG47k5zSU6yTPoCP/AIJRfAm48LpqTIvm/Z9/+rHXGa/O34f+A5Pgv+0JNpOgpi0t9u3t3Nf02af/AMifH/16/wDslfhV48uLf/heF0qooPHb3NXluPrVeaFV3QszwVKgozpqzP2b+EXie68S6T9ouG3ELXrlfNf7NrM3h07v7gr6Ur5rEpe0aPosK70k2f/W/v4ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigBrcrX5K/tcafayaxNMw+bca/WpuFr8rf2sLdm1CaTH8Rr878SaPPljPqeFJ2xaPj/4ByNDrx8v+/X7q/DVmbwvCWr8FPgzdNa+IDt/56/1r94PhTL5vhGFq+P8IJrllA+j4/j+9R6VRRRX7ofmYVheIl3aFeKv8UTfyrdqtdW63Nu9u3RxinGWopR0P53PjlrVv8P/ABlfa7q3ERbd6V718Df+CjfwV8I+G/sOrS/PtH/LQf4V9m/Gb9ifwT8YreS31Zotr5zuGetfHU3/AARl+Dszbt9v/wB8f/Wr6yGLwNWioVm7ny0sFjKdVzpJWPbo/wDgqF8AZZEhWXl2C/6wf4V9jfDn44+E/iRYxahoZykv3ec1+ZMP/BGf4PwTJcK9v8jBvuen4V+iHwf/AGcfDvwj0uHS9JKbIfu7RXm4+OD5f3Ddz0MHHF+0/fWse0+PNLOueEL/AElRk3ERWv58viB8Mdc/Zy8YX/jiEeQLiXzd2MV/RvJ8vHrXz/8AHX9n7Qfjno40nXSmzZt+YVhl2P8Aq7tLZ7m2ZYL6wk4bo/Pz4bf8FJvhJ4d8KjT/ABVNm7XHzeYBX5l/tseIrj9sX4j6PrXwrO+GG8idv4uFIz0r9Jta/wCCO/wh1e6N3M9vu/3f/rV9DfAr/gn34B+CO0aKYvl/urivcp4/A4aTrUb8541bL8ZiEqVX4D6G/Zb0G/8ADfwV0fSdS/10afNxXpHxQTzPA94i9dtddpdjHpdiljH91Kr6xp8esafLp833Ja+VnVbq8/mfT0aPLS9mux+D2paPdf8ACTSt/wBPH9a/Z74IxtF4Bto2/wA8V55J+zP4amvGvGKbi27pX0B4f0OHw7piaba/dSvQzDGxrQSRwYDCVKcm5H8sf/BVXwTq2tfti+HNQtR8i6pnp/sPX9Kf7PtrJa/Brw9bN1S1G78zXjnxh/Y/8HfGDxxaeNdY2edaS+au4Z55r6x8NaDb+G9BttDt/uWybBVYzHqrh6dJdCcHgHSryqvqfn1+2BpNxdeEbzy/88V4r/wTB0u50+G887+9L/M1+m3j74Y6X4602XT7/bsf+9XK/Bv4F6H8IVkXR9p8zP3RjrR/aEPqzoyF9Sl9aVToe431jBqEPk3AytfzLftifBH4naT+1FY/EPSzs0eznZ3+U9Prmv6ek+7XjPxI+D+j/EfS5tL1Lbtm+9kVnlOP+q1G3sy80y/6zCy3R8D+Ff8Ago18GvCfhuz0XWpf39tAIn/eAcgY/u18b/tdftJaX+0/4Fm8D/DabNzJnaud3Ue1fTniP/gkR8JfEN7LfXL2+6STf9z/AOtXp3wi/wCCZ/w1+E2vJr+kmBnTH3Vx0/CvYhicvpP2sG+c8ueFx1ReyqWseR/8EkfgV47+Dvw3l0/x8v75oAq8Ec5HrX7IPGvkt/umszSdGg0mHyYfu4rXYjbtWvmsZi54is6j6nu4PCrDUlBdD+U/4teGdTm/bst7qP7nzf8AoYr+lv4XWslrodsJP+eC/wAq8E1r9jfwZrHxJHxHl8r7Sme3PJzX1xpemx6XbpbR/dRQtelj8asRTjDsjlweAdGrKXdn5Wf8FabKa/8AgmVh/uSVZ/4JN2Mtj8DRHN12JX3R8dvgbofxw8M/8I3rW3y9pX5hnrU3wJ+COi/A/wAM/wDCOaLt8raB8ox0qXj19U+reZKwM/rftelj2a+tzdafcW/99GX8xX8//wAZP2e5Phb8Wrv4xSQ+Wp/jx6En+tf0HLz8vavHfjB8JdL+Lnhl/DOsbfLfP3vesMvx31eb7M6cwwf1mKtuj82fhZ/wUf8AhboOjvb+KJt8qpt++Bz+VfFf7eHxi8P/ALZ3hlPC3wvbfOibOu7nOe22vtHUv+CQPwh1AlpXt/m/2f8A61er/BH/AIJr/Df4K602saK0G8tu+VcV7uHxuBw8vbwvznhVMFjqy9lUtyHon/BPfwHrHw9+BtvoeuLiYbe2Ogr71AA6VzWg6PF4fs/sNv8AdFdEjfw18zXxDr1ZVH1PpMNRVKnGn2JKKKKwOgayhutfNn7T3w0j+KXw7k8NtF5mc/L9RX0rULLtq6U3TkproTUpqpBxfU/l/k8H+Ov2WfFFtZ6M/wBksIpdsq4x8o/Gv0q8J/8ABTb4J6PoNrpuuTZuYU2yt5gHP5V9d/Gb9mfwz8ZGlOrsg8z+8M1+fmqf8Ecfg/qWoSX0ht90rbvu/wD1q+n+u4XEr/adH5HzP1DFYab9hsY/7TP7fnwb+LXwsvPBvht91zcfd/eA9vTFcH/wSh8G6ppMV5cXS/LKZWX8STXsHh//AII+/CPQdSTUoTb7k/2f/rV+h3wY+AOg/Bm1+y6KV27dvyjFZVsfhaVB0aDbv3HRwGJq11VrW0PerHKxhWr8B/20vgr4yvPjEnjoD/Qbd2Z+PX3r9/lXbXmfxC+Gel/EDRJ9I1DGyZfm3V5WBxrw9TnfU9jH4T21L2aPyD+CH7anwd+Esa2OuHEsa7G/eAc/lXA/tp/tYeBf2lvhXJ4F+Hsubx9235t3UY7V9HeKv+CSPwn8UXsl9cvBmVi3zKe/4Vu/Df8A4JV/C34b60mtaY0G9cfdX0/CvdjisBGXtU3zngTwWOnT9m0rHmH/AAR1+D/jD4V/C+Wx8WDbI1uF6Y7iv2qZv3LL/s1xPgvwXZeDLL7Labdu3b8tdoYwd27vXgY/EvEYh1WfQYDDLD0VTP5lfina3H/DaEMi9Pm/9DFf0LfCnb/YsGf+eY/lXgevfsY+Ddc+Iy/ES4ZPtK57c8nNfWmgaDBodultb9EULV4zHKpGMF0McLg3TqOfc6Ddt56V8y/tReB5vFnwj1a00lP9MdPkavphl3VVvbRby0Nq33TXn0qjp1FNHbWpqpTcGfy7/seeJte/Y58fapq3xilxBNdSsn8PDE467q/VA/8ABUD4CyWuxJfm/wCug/wr1D9ob9hLwL+0Au3XjEOn3hnpXyXH/wAEZvg3G2Va3/74P+FfXVMbgcU/a121PyPmqWDxmGXs6VmvM/Q/4H/tHeDfjFpf9oeHX3Jt3dc19KqwkgaQdCpr5F/Z5/ZI8J/s/wCk/wBl6CUZNuPkGK+vo4VjgEP8IGK+Zxfs/aN0tj38B7X2dq25/LD8StH1pv28Le6B/d/N/wChiv6ZvAK/8SO1z/zyX+VfNOsfsb+DdY+JafEeYp9pXPbnk5r6803S4NLt0t4fuooX8q9DHY9YilGC6I58FgHRqyl3Z4j+0Vb3Fx4V22/3tpr8edFsdQh+L1h5n981+8Xibw7beJrP7Hdfdr55/wCGXfDK+JIvEHyb4/m6UsFjY0qbgyMwwUqtVTR9Daav/FGxL/06/wDslfhv4+0G9j+NV1eN9xsfzNfvBBZLBp62I+6qbK+dda/Zv8O61rr6zNs3v7VlgMYqTlfqbZhg3VjFLoH7NuB4db/cFfTGxq4nwT4JsvB9n9ls9u3bj5a7ltvfrXBXnF1G0dtBONNQZ//X/v4ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAr84f2otL85bm5x61+jG5hXxH+0lpskmi3lxj5RXxvHNP2mWSR7/D9X2eLifkf4D1aPSfER3f89f61++PwUulvPAdtMvf/AAr+ebR7hP8AhJnX0n/rX9BXwCbPw7tf89q/K/CCpbEVI+R9tx/HSMj3Ciiiv6GPyoKKKKAIfmWneZ/n/IqSmeWv+f8A9dTylc3cTzP8/wCRSZX0p+xaNi0SiSQ1IG2pTti0Mu6nyoIxIad8y0fMtCrupRj3HKI1squ6lVd33alZQ3WhV20+VCI2XbTasU3b8u2iMRcqIak8z/P+RS+Wv+f/ANdLsWlyjIWc7fpUcbf41Z8tf8//AK6Ty1o5Q1sO+8tQ1YpuxaoI+ZDRUknagR+tTyrqKUXuN3tTZEYLTmHzfWpNuR81OMQ5e5DRU2xaTy1/z/8ArpSj2FykDSfjUittp3lrR5YA4pSh2KG72ptSBPWhk4+WnGNhSiR075lqRd38VDLuo5X1Ht8JBhaljHenbFp1PUUYhRRRTGFNZd1OooAi8tv8/wD66Rl21NRSlECvRU2xadRy22FyohVd1Dfe4qaily9xleipiqtzSeWv+f8A9dHKLlQirleajC7jVimqu2qGRsu2m1YpuxanlFIj/g/Gm1NsWo2XbVBGNxtFOVd1SbFqJRYcqIaczbqf5a/5/wD10qrtpxiVGRDRU2xaFXbRyiDb8u2oW+XrVio23buKUogR0U5l205V/iNPl1Acq7aaI/X/AD+tSUUcpXMz/9D+/iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAIWbdXgPx48PLe+A7+Xbk7a+gJO1cT8QLNb7wrc25XO5a8rO8L9Ywk4eT/I68JV9nXhNdz+aGVbjR/Fku5GH+kf1r+hb9nC4+0fDK1k/z0r8Zfjt4bt/DWvedsxvnDfrX7Bfsx30cnwxs1H+eK/AfDKnLDZxUo1OiP0rjGqq2AhWXc+mqKjaQLTlbdX9Jn5UOooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9H+/iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAI5O1ZuoW63li9u3R60pO1V9/wA3tUTV04DjKzuj8df25vC8Wj3FvNCPvMrfrX1d+yxrX/FG2dpurmf21PAzeJ7eFoR9zb+lYv7PMraPJDo5P3cV+FUMHUwXE03b3GfoVSusRlNOPVH6QN83WpFXHzGoU+7UiyfjX7vKJ+fdCaiiimSFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH//S/v4ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigCH+L5qjf7tTSdqi7fNUy01HKR5Z8RPC8fiO1bzBnatfIvgfS5tM+JBt14Rcfzr9Bpod0bqe6mvAbPwWsPjN9U2fe/ir4zPcr58VTrw7nt5fjLUpU59j6ET7tO27eOlFFfZc1zxIyJU6U+mp92nVY5BRRRQSFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAf/T/v4ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigBr/dqGpX6VFSkVEF7bqgaCHzPMCfNU9FJ01LcPg2I1X+I05Pu0o6Cnp96qj8BP2iRPu06iigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9k=";

// Helper storage : retourne null si clé absente, évite les try/catch partout

// ─── DataStore : store global partagé entre tous les modules ──────────────────
const DataCtx = React.createContext(null);

function useData() { return React.useContext(DataCtx); }

function DataProvider({ children }) {
  const [store, setStore] = React.useState({
    ecgs: [], imagerie: [], agenda: [],
    divers: [], dilutions: [], gestes: [], retex: [],
    contacts: [], loaded: false
  });

  React.useEffect(() => { loadAll(); }, []);

  async function loadFiles(items, fileFields) {
    for (const item of items) {
      for (const field of fileFields) {
        const urlField = field + "Url";
        const dataField = field + "Data";
        if (item[urlField]) {
          const fd = await safeGet("file_" + item[urlField]);
          if (fd) item[dataField] = fd.value;
        }
      }
      if (item.medias?.length) {
        item.medias = await Promise.all(item.medias.map(async m => {
          const fd = await safeGet("file_" + m.url);
          return fd ? { ...m, data: fd.value } : m;
        }));
      }
    }
    return items;
  }

  async function loadAll() {
    const next = { loaded: false };

    const re = await safeGet("admin_ecgs");
    next.ecgs = re ? await loadFiles(JSON.parse(re.value), ["image"]) : [];

    const ri = await safeGet("admin_imagerie");
    next.imagerie = ri ? await loadFiles(JSON.parse(ri.value), ["image"]) : [];

    const ra = await safeGet("admin_agenda");
    next.agenda = ra ? await loadFiles(JSON.parse(ra.value), ["image"]) : [];

    const rd = await safeGet("admin_divers");
    next.divers = rd ? await loadFiles(JSON.parse(rd.value), ["image"]) : [];

    const rdil = await safeGet("admin_dilutions");
    next.dilutions = rdil ? await loadFiles(JSON.parse(rdil.value), ["schema", "photo"]) : [];

    const rg = await safeGet("admin_gestes");
    next.gestes = rg ? await loadFiles(JSON.parse(rg.value), ["image"]) : [];

    const rr = await safeGet("retex_submissions");
    next.retex = rr ? JSON.parse(rr.value) : [];

    const rc = await safeGet("admin_contacts");
    next.contacts = rc ? JSON.parse(rc.value) : [];

    next.loaded = true;
    setStore(next);
  }

  // ── Supabase : écriture directe ──────────────────────────────────────────────

  // Upload image base64 → Supabase Storage
  async function uploadImageToSupabase(fileName, base64Data) {
    if (!base64Data || !fileName) return null;
    try {
      const url = await uploadMedia(fileName, base64Data);
      return url;
    } catch(e) { console.warn("uploadImageToSupabase", e); return null; }
  }

  // Prépare l'item pour Supabase (supprime les data binary, convertit les champs)
  function prepareForSupabase(table, item, fileFields = []) {
    const copy = { ...item };
    // Supprimer les champs binaires (déjà uploadés)
    for (const f of fileFields) { delete copy[f + "Data"]; }
    // Supprimer id si c'est un Date.now() (Supabase génère son propre UUID)
    // On garde id seulement si c'est un UUID valide
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (copy.id && !uuidRegex.test(String(copy.id))) delete copy.id;
    // Convertir medias en array sans data
    if (copy.medias) copy.medias = (copy.medias || []).map(m => ({ url: m.url, name: m.name, isVideo: m.isVideo, credit: m.credit || "" }));
    return itemToRow(table, copy);
  }

  async function addItem(storeKey, storageKey, item, fileFields = []) {
    const table = TABLE_MAP[storageKey];
    if (table) {
      try {
        // Upload images vers Storage si nécessaire
        for (const f of fileFields) {
          const dataField = f + "Data";
          const urlField = f + "Url";
          if (item[dataField] && !item[urlField]) {
            const url = await uploadImageToSupabase(Date.now() + "_" + f, item[dataField]);
            if (url) item = { ...item, [urlField]: url };
          }
        }
        const row = prepareForSupabase(table, item, fileFields);
        const result = await supaFetch("/" + table + "?select=*", "POST", row);
        const newItem = Array.isArray(result) ? rowToItem(table, result[0]) : rowToItem(table, result);
        setStore(prev => ({ ...prev, [storeKey]: [...prev[storeKey], newItem] }));
        return;
      } catch(e) { console.error("addItem Supabase", table, e); }
    }
    // Fallback localStorage
    const newItem = { ...item, id: item.id || Date.now() };
    const exists = store[storeKey].find(x => x.id === newItem.id);
    const updated = exists
      ? store[storeKey].map(x => x.id === newItem.id ? newItem : x)
      : [...store[storeKey], newItem];
    try { localStorage.setItem("sau_" + storageKey, JSON.stringify(updated)); } catch(e) {}
    setStore(prev => ({ ...prev, [storeKey]: updated }));
  }

  async function removeItem(storeKey, storageKey, id) {
    const table = TABLE_MAP[storageKey];
    if (table) {
      try {
        await supaFetch("/" + table + "?id=eq." + id, "DELETE");
        setStore(prev => ({ ...prev, [storeKey]: prev[storeKey].filter(x => x.id !== id) }));
        return;
      } catch(e) { console.error("removeItem Supabase", table, e); }
    }
    const updated = store[storeKey].filter(x => x.id !== id);
    try { localStorage.setItem("sau_" + storageKey, JSON.stringify(updated)); } catch(e) {}
    setStore(prev => ({ ...prev, [storeKey]: updated }));
  }

  async function updateItem(storeKey, storageKey, item, fileFields = []) {
    const table = TABLE_MAP[storageKey];
    if (table) {
      try {
        for (const f of fileFields) {
          const dataField = f + "Data";
          const urlField = f + "Url";
          if (item[dataField] && item[dataField].startsWith("data:")) {
            const url = await uploadImageToSupabase(Date.now() + "_" + f, item[dataField]);
            if (url) item = { ...item, [urlField]: url };
          }
        }
        const row = prepareForSupabase(table, item, fileFields);
        await supaFetch("/" + table + "?id=eq." + item.id, "PATCH", row);
        setStore(prev => ({ ...prev, [storeKey]: prev[storeKey].map(x => x.id === item.id ? item : x) }));
        return;
      } catch(e) { console.error("updateItem Supabase", table, e); }
    }
    const updated = store[storeKey].map(x => x.id === item.id ? item : x);
    try { localStorage.setItem("sau_" + storageKey, JSON.stringify(updated)); } catch(e) {}
    setStore(prev => ({ ...prev, [storeKey]: updated }));
  }

  async function addRetexItem(item) {
    const table = TABLE_MAP["retex_submissions"];
    if (table) {
      try {
        const row = prepareForSupabase(table, item, []);
        const result = await supaFetch("/" + table + "?select=*", "POST", row);
        const newItem = Array.isArray(result) ? rowToItem(table, result[0]) : rowToItem(table, result);
        setStore(prev => ({ ...prev, retex: [newItem, ...prev.retex.filter(x => x.id !== newItem.id)] }));
        return;
      } catch(e) { console.error("addRetexItem Supabase", e); }
    }
    const toStore = { ...item, medias: (item.medias || []).map(m => ({ url: m.url, name: m.name, isVideo: m.isVideo })) };
    const updated = [toStore, ...store.retex.filter(x => x.id !== toStore.id)];
    try { localStorage.setItem("sau_retex_submissions", JSON.stringify(updated)); } catch(e) {}
    setStore(prev => ({ ...prev, retex: [item, ...prev.retex.filter(x => x.id !== item.id)] }));
  }

  async function removeRetexItem(id) {
    const table = TABLE_MAP["retex_submissions"];
    if (table) {
      try {
        await supaFetch("/" + table + "?id=eq." + id, "DELETE");
        setStore(prev => ({ ...prev, retex: prev.retex.filter(x => x.id !== id) }));
        return;
      } catch(e) { console.error("removeRetexItem Supabase", e); }
    }
    const updated = store.retex.filter(x => x.id !== id);
    try { localStorage.setItem("sau_retex_submissions", JSON.stringify(updated)); } catch(e) {}
    setStore(prev => ({ ...prev, retex: updated }));
  }

  async function updateRetex(item) {
    const table = TABLE_MAP["retex_submissions"];
    if (table) {
      try {
        const row = prepareForSupabase(table, item, []);
        await supaFetch("/" + table + "?id=eq." + item.id, "PATCH", row);
        setStore(prev => ({ ...prev, retex: prev.retex.map(x => x.id === item.id ? item : x) }));
        return;
      } catch(e) { console.error("updateRetex Supabase", e); }
    }
    const updated = store.retex.map(x => x.id === item.id ? item : x);
    try { localStorage.setItem("sau_retex_submissions", JSON.stringify(updated)); } catch(e) {}
    setStore(prev => ({ ...prev, retex: updated }));
  }

  return (
    <DataCtx.Provider value={{ store, loadAll, addItem, removeItem, updateItem, addRetexItem, removeRetexItem, updateRetex }}>
      {children}
    </DataCtx.Provider>
  );
}

const LIGHT = {
  bg:"#F0F4F8", card:"#FFFFFF", navy:"#1A3A5C", blue:"#2E7EAD", blueLight:"#EBF4FA",
  green:"#2E9E6B", greenLight:"#E8F7F1", red:"#E05260", redLight:"#FDF0F1",
  amber:"#E8A82E", amberLight:"#FEF7E8", text:"#1A2B3C", sub:"#5A7184",
  border:"#DCE8F0", white:"#FFFFFF",
};

const DARK = {
  bg:"#0F172A", card:"#1E293B", navy:"#0F172A", blue:"#38BDF8", blueLight:"#0F2942",
  green:"#34D399", greenLight:"#0D2B20", red:"#F87171", redLight:"#2D1217",
  amber:"#FBBF24", amberLight:"#2A1F05", text:"#F1F5F9", sub:"#94A3B8",
  border:"#334155", white:"#1E293B",
};

const ThemeCtx = React.createContext(LIGHT);
const useC = () => React.useContext(ThemeCtx);

// Alias module-level C = LIGHT (pour rétrocompatibilité hors composants)
const C = LIGHT;


const RETEX = [];

const ECGS = [
];

const ICONO = [];

const AGENDA = [
];

const DIVERS = [
  {
    id:4,
    title:"Objectifs tensionnels",
    source:"SMUR BMPM (@SMURBMPM)",
    tags:["#tension","#PAS","#PAM","#AVC","#trauma","#urgence"],
    imageData:"data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QCMRXhpZgAATU0AKgAAAAgABQESAAMAAAABAAEAAAEaAAUAAAABAAAASgEbAAUAAAABAAAAUgEoAAMAAAABAAIAAIdpAAQAAAABAAAAWgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAzqgAwAEAAAAAQAABX8AAAAA/+0AOFBob3Rvc2hvcCAzLjAAOEJJTQQEAAAAAAAAOEJJTQQlAAAAAAAQ1B2M2Y8AsgTpgAmY7PhCfv/AABEIBX8DOgMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2wBDAAEBAQEBAQIBAQIDAgICAwQDAwMDBAUEBAQEBAUGBQUFBQUFBgYGBgYGBgYHBwcHBwcICAgICAkJCQkJCQkJCQn/2wBDAQEBAQICAgQCAgQJBgUGCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQn/3QAEADT/2gAMAwEAAhEDEQA/AP7G/wDhCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulooA5r/hCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulooA5r/hCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulooA5r/hCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulooA5r/hCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulooA5r/hCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulooA5r/hCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulooA5r/hCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulooA5r/hCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulooA5r/hCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulooA5r/hCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulooA5r/hCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulooA5r/hCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulooA5r/hCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulooA5r/hCvBf/QHsv/AeP/4mj/hCvBf/AEB7L/wHj/8Aia6WigDmv+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpaKAOa/4QrwX/0B7L/wHj/+Jo/4QrwX/wBAey/8B4//AImulrD8SeJdB8H6HdeJfE93FY2FnG0k08zBERVGSSTWtChOrNU6au3skZVq8KcHOo7JdWVT4M8FKMnSLID/AK4Rf/E18NftN/tr/sb/ALLNpNH44fTbnVI1JXT7SCKSYtjhWCqdufUivxg/bz/4LOeK/HWp3fwZ/ZJLxWsrmCTVY1LT3HUMkCc4B9cbq/O79n39iPxD+0fpY8ffE3xHPaXWr6g2l26SRTXF0Lvg5uOGMcfzjJfA61/UPCfgNh8Nh45hxTU5Iu1oR+LXv226H818U+N+IxOIeXcMQ55a3m/hVu3d+v5H2H8cf+C3Xi/xRqEth8BfBGl6PYbSvmXttHNOP9pSoAHHqK+LofGn7fP7R+jXfja3nnudHjWSSScwQRWyKmd2GMeAF6da+nfhV4W8V/Cb4R6Jb/s46dpWu64mtzaf4sN7HbySL5MzIse24z5cTRqp3rggk81wfif4xfCv4Z/Er4wfCvTdZbTdB8RaAIreCGWR7aDVZDHJcRwhSVCiQOAQMV++ZLgcDQ5qGTYOEeW2rXM/iUXdOzTs+ZXbutT8QzjHY6vGNfOcZJ83Tm5Y35XJWtdNXXK7Ws/I+dvEP7NnieH9nCP41+Kru2k1fUbjdZxtPbx/uI+HIiIDSs2Rt2dO/Ws/Tv2ef2svh34Mb4haTaw2sUUH21oFeA3aQ4z5jWxBcLjkkivfov2oPhRf/sg+Hvh1c60kOs+HfNc2T2scrTnKeWoldCyA7TnawrufEP7U/wCy74h0nXviNrF5f3ureI7Vo/7Hd3jNtM8IhGJI8HyFIDbN3PPFevSxmcRXJKhzLnd/dT0voully9dTx3hMok+ejiOWShGz5uvLq9b3d9Oh458Lv20v26Pg94atviZeQPqvhqdT5UuoWCPZthtp+dY1/i4+91r9Pv2cv+C4Pwm1M22gftH+CrTT5pHxJqFlbxtCq9MmLaX+teHfExvhr8ZLf4Z/DH4aXdlD4Qgjt0nu0u3WPy4Ift15HLbO4GfMRwrbOeBnnFeEf8FJPD/7Puj+FbPUPCqab/wkWrXMF3pf9mJNHnRpUZohMrKI9+0pyoyec18bXyTJc9q08LmOA5Z1Lu8U4uKTtr083+R9dRzrOMkw9TFYDHc1OnZWk+ZSbt57dI2V99T+tT4Q/EL9nT46+H08TfC59J1a2dQxEMUJdM9nTBKn6166PBfgs8/2PZf+A8f/AMTX8DPhOD9q/wDYj0Xwr+0H4burnQLXxG0jWKb/AJZkTBYvEeCCG6la/qC/4J6f8FX/AAD+1ZBB8P8A4jeVoPjBQE8pnxFdEDloy3c+hx7Cv588RPAqvl1F5jlM/bYfXVWurO19N1dWuj954C8aaOYVVgM0h7HEaaO9pXV9L7XWtj9Zf+EK8F/9Aey/8B4//iaP+EK8F/8AQHsv/AeP/wCJrpcEcHrRX8+WP3l+ZzX/AAhXgv8A6A9l/wCA8f8A8TR/whXgv/oD2X/gPH/8TXS0UgP/0P7QKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigPQpalqNjpGnTatqcqwW9ujSSSOcKqqMkk+gFfx8f8ABSr/AIKA+Pf2x/iJL+zh+z+lzN4bgmaB44P9ZfyoeS2DjywRwCcEDNfof/wW3/bevPhX4Otf2cPh3dtFrWvx+bfvGfmjtWyoUEdC5BBHoa/J/wDZA+BWufA7xXpnjbVPEWnad4y1W0eW08O38e4XNrKhyrSlh5TyRnKZBzkV/YPg9wVQyfALP8dBOvNP2UWui3k+3r08r3P5O8WuM6ubY/8AsDBTtRh/FkuvaK6fI8U/YS8T+A/hJ8a7/wCHfxsshpV/qamws9XkiSZ9Lu8gLKqsQvB43hsjtXu/xM/bv8d/AT9oL4haDoFi+nxahbfYi1tL5LvdRKWhvG8s43MWBcZO4AAmvIv23PFH7OOqWkF34Ft54PE+6OF7BVMUel/ZwVljcn/XM56OMdOlfOX7Pv7JP7QH7WXik6d8OtInvPMb99ezBlgTsd8jcZx0zX9C1MDldWnLPM4XJGUdVN6XVtV622t5n4L9ezOhKOR5O+ecZOzirvla2bstfuOG8d/HT4m/FLxlceLJnSxv76FYLgaVCLXzxgA+YkON7MfvE5JrxSVDFO0VyCjAkMCCGyPUHnNf10fAj/gh14T+EEvh34gal4nabxNpV3Hd3LtHm1aIAFodhOM9t5OPauh/bd+Fn/BOn9j6yvPi78RPA6+ItX8SSvNbWu3dFLMxJIDDiPPJyQa+VwH0gMsqYyOAyfDSq82kVFKOq9baWV0+3Q+kx3gNmUcNLMc3rxg07yveSs/TW97Jr8T+O5mCrk85x7UgQt8w7dfav2Q+Od/+xloen6J4m8b+CP7Judfgjv7fRNHfypLa1l5SSWfDB9wz8m0dOte76B4u/wCCfnwqtPDFx44+H1tr3hPxSg8vW0QiW1l/igkh5LOvBJyOvSv0Cv4kVoUoVIYOcnK9ldK9t7PZ+Xc+BwvhrRnVdKrjIRUbXdnpfa+mmu/a5+BVpDqQVtQ0+OXbHkNKmcKCMEFh0znHXvXp/h/4s3V14t8Oat8TRJ4g07QCiraSuRuhjA2RBucKCBj2GK/sr1r/AIJlfs2eMPgBqvw9+DCJoNr43FpfPcOgeUW+6OXbEOCm5Rjvgmvx9/bI/wCCGXjj4bWc3jT9m+6k8QafEu6TT5f+PmNQOSrdZCfQAV8NkPj5w/mtX6ti70pSulzdn59G9du259vn/gRn2W0liMFaokk5ctt91aPW1lv3PUNB+MP7Mn7VHhjRfHfxdE2sW3geye/k0iMCO0tZJlAS1Ta26QnZhU2bfU81+VPxE/Z+/aI1XUdc/au8FeD5vCXh2ynW8tDCVg8lN4WIxAYIPRjkD2zXyn4c1/4n/ADx0Lq1WbR9XsZBvjmQqVZOzIeDzX7e6B4x1b9v/wCCWg/DS31620nUdRlX/hLtUm/dM5RsQQQxZ/eHIU5GOtdOLyuXDtVYjCyUsNN6t3lyx3aSWln3W7ZOEzaHEFKWHxMXHEQ1SVo80lpdt63S1fSy36H6Q/8ABKD/AIKVRftL+Ho/gz8WrsL4x0yILFM5/wCP2NRgHPUyAdeueSTX7dHjn1r+FD9pH4SP+w38SPCXxb+CN1fad5c0iBbvMVwJ7OQwyOoPPlTYZh6Bsc9a/sF/Y0/aY8P/ALVvwG0f4qaMyLczxiK9hU58q5QASL9A2cetfyt42cAYbCuGe5VG2HrXuv5Zdfv1sf0x4OcdYjE8+SZpL/aKSWu/NHo7+XU+qqKO9Ffz42uh+8H/0f7QKKKKACiiigAooooAKKKrXt7Z6daSahqEyQQQqWeSRgqqo5JJPAAHc0AWcjpS4Nfzyftuf8HJn7BX7I2vXfgTw5dXPjvxBaMYpYdICtDDIvVZZHZf/HcivyVP/B4to/8Aa2xfhY32Hd97zj5u36bsZ/GgD+4Tr0or+eb9iH/g5K/YL/a78QWngPxDd3PgPxBeMIoYdYCJDNKeixyIzDk9N2K/oQs72z1G0jv9PlSeCZd0ckbBlZT0IIyCKALNB4GT0r5X/bW/ah0P9jH9mfxN+0n4ksZtSsvDMKTSW0GPMcO4TC5IHf1r+dz4Cf8AB1n8A/jt8ZfDvwe0nwDq9pc+Ib1LKOaTy9iM/QnEpOPwoA/rLoqOGQSwpKvR1DfmM1JQAUUV/JD/AMHCf/BbL9pH9gj4kaN8Af2ZEh0vVLq2F3darcxLMArAFUjRwVPB+bPIoA/reor+a/8A4N5P+CuXxo/4KUeEPGHgr4/WkUniLwalvO+pQII47mO5YoAVUBVYFTkAd6/pQ570AFFFFABRRRQAUUUUAFFFFABRXj3iv9oL4H+BNZk8PeNPFel6XfRKGeC6uoopAD0JVmB5rr/BPxD8DfEjS31rwDq1prFpG5jaa0lWZA46qWQkZ56ZoA7KjrXy9+2h+0I37Kv7MXjD49xWTahL4dsJLiO3UZ3yYwmcdt2Mn0r+Br9nj/g6Z/b6l/aV029+Kn2LWfB+q6hHC+jQ26I0MczhR5cqqHcrnv1FAH+kNRiqtjcreWMN6OBLGr/TcAa/mY/4LH/8HDXgz/gn14wm/Z++COkw+KfHkKf6aZnK2tluHCsVyxkHXbjHvQB/TjRX+aRon/B1d/wUfm8RR7rfSbuOeZVjtDEqjLNgLuVN3fFf6G/7KnxC8cfFr9nDwV8T/iPaxWOt6/pFrf3dvCSUilmQMygkA8E0AfQFFFFABRRRQAUUVzXivxl4U8CaNJ4h8aahBpdjDjfPcyLHGueBlmIHegDpaK8U8P8A7SPwC8V6zb+HvDfjHSL6+um2QwQ3cTyO2M4VQ2SfpXtdABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABR060A45r+HL/guD/wcDftffss/teXn7Nv7Lr2/h6y8Oxwvc3dxbpPJdPIMkBZFIVQQcEcmgD+43NFfi/8A8EN/+Cj3jj/gpL+yN/ws/wCKGnJZeItGvZNNvJYBiG4MaqRKo4ALFuVAwK/aCgAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAClwaimkEULytyEUt+QzX8kXxe/4OyP2f/hJ8Ttc+GmofD/WLifRLyWzeRfL2s0TFSRmUHHHpQB/XDRXzb+yJ+0dov7Wv7PPhv8AaC8PWUun2fiO38+OCfHmIPQ4JH619JUAFFFFABRRRQAUUUUAFct448W6X4D8Han411ttlnpVtJdTNnGEjXcT+Qrqa/K3/gsh8Vbz4YfsSa6uk3HkXetTQ6cFB+Z4rglZAPbHWvquCMjlmWb4fAr7ckvl1PmeMs8WXZViMd/JFv5n8lfxa1b4s/tm/Hzxn8WdGtWvJUllvJSXAjgt4jtTBY4AIXgDqeBmvo/Qf2vfFvgDRdMi/ap8BtrWp6fZFvD+qXUbW9wg2lY8thA8aAjHU8CtH9hvwZ8cvBXw41/4heEND07X7PX4USLSryVo7m4W1fzVnhRVIdEYZZWO0hSOa8r/AG9vjD4l8W3Hhz4Y+K9LudPvNDt/OuDeury+ZdHzdiBGZUiXdhEGMADgV/o5CVPH5gsrVOEqNPRNO0opRXz30fdH+fdaNXL8vlmvtJqtU1aavGTf/AfyPg3XvEl/4n8SXPirW3M95dztPM5/jZm3Hpiv7u/+CY/xK+HfxE/Y+8PeI/Bljbab9hh+yXyxKEAniGX3HqeCDk1/Dfp9/wDCYWcMGq2t8Zwo8x1243d8AmvvT9nD9rfVPgv8GPGvwe+FPiCS3fxbCkNvHe5T7OzZWZoym4B3UgA5HSn40eF9XiPA0qOGdpQkv/Adn5aLX5Hk+D3i3Dh7HVauOptxnFr4bu6V156vQ+/f+CoH/BT/AMbfEXxzP+zR+zHdSQ2MEhtby9tTmS8nb5TFGRyEBOOOd1ed2uk/Ez9q39gbX/hB8SYL4+PfhRMt9aRToxuLiAg4TBGSFDD3r3D/AIIqfD/4R6a3iCb4zWFld+J31BZdPe5RZ32lVO9Dhtp35OTjnNf0uWnhPwfaazc6zY6baR312oWedYkWWUejtjLD2Nfzjxxxnh+GMTDJsDhLfV5Jqb3k+r9JK6P6W4I4WqcUYeedYnGc6rpxcVqopp2+cXZr8T+P34Nfs3eEP22jpEHxXg1nwnrnhzQTaTMLOUxXMdmoETo2zAbk7lPJ421haL8Err4z/GnwB+y18P8AQNWtfB3h+9a6vL6+tpI/tMqH9/MCygKrRrgA+lf2Jx3nw+0SZ7aGewtZEyjKHjQj1BGRV7TYfCF7IdR0gWs7pkF4tjkZ4IJXPWvl6/jbmUI1JvDyUWrRu3aHMraab72b2PosN4SZZUnCjHExlNO8rWvLla31v01S3P46f2xv2t/2kT+0VefFP4E3Gp6f4O+HzxaLYybGECrbARuknG0h2U9ecHiv6Iv+Cdv7efhj9tP4Y/aroxWnijTVCahZhuSccyIDyUP6ZGa+tPF/g/4G6T4N1G28WaPpseh3Dma9ja2RoXf+/IoUhmHXJGa/kX8V/FHW/wBlr9vTV/i/+zPaJJ4YaVo2gsighmhcHcgXIx82D0HSvqcmwVHjnLZYPC4T2VWglyTWql05ZOy1e58xnucS4GzGGMxuL56ddvng3qut4rWy6Hff8F3fiN8Odc+PGmfDvwjptvBqOjwmS/vIAoaR5eBG+Mcpg9fWvyO+Afxf1/4N+PrfxJoLR+aySwKJixjjMyGPzdoOCybtynsRXc/FjR/iT8Z/ibrfxX8esmnyavdPdTS3Mowm85xgEnj2Feb/ABG0b4Q6JoumWXgHU7vVdVwW1CSSNVtwewhIO5v+BAV/X3DfClPAZNRyeqnJKNn27u/z2P5Fz7jaWYZ5VzbDyS1uvT/O25+1WufBf4WWXw9Wb9pS8k1pvE1xBBZ69eyt5lukthJdFrYZC4MyKhyD19az/wDghl+0pdfDn476l+z7rU6ppPiRTJb+blSLmLhFQHgb9xJ9cV5X+yL8bvh9p3ww0K31LQbrxh4ihuZrWVbrzr9bVDHIYJIraXdbqoYKpJxjNeE/GDxB45+EH7V/gj45+IPDx8MXzrZXUtunkoj3MeBO6RwsVRGZsgEDjtX4tXyGpjsJjsixerkm1dr4o7NRu7Ky769lc/c8NnkMHisHnWEtaLUXZP4Zd5aJu77ad3Y/vA70Vz3hPWbXxF4ZsNds3Ekd3bxyqwOQQyg10Nf551KbjJxa2P70pyTipR2Z/9L+0CiiigAooooAKKKKACv4mf8Ag56/4K6eMPhvep+wb+z7qj2F3cwCbxJfW7YkEb8Lahhyp4beO4Ir+1rUZza6dc3S9YopH/75Un+lf40P/BQ74vat8ev22fiT8UtZmM8ura3cSAseAAdoA9uKAOy/YD/4JyftKf8ABSP4rN8P/ghY+YkBEmo6nckrb2yE8s74OWPZe/rX9PH/ABBs+JT4R+3n4zx/235eRaDSh5O/H3fO+09M99v4V+5n/BuB+zL4Z+A3/BNPwp4ss7VItZ8aeZqWoSgDczbjGg3dcbAK/fSgD/HF/b+/4Jx/tIf8E3/isvw6+Olh5cV2Wk03U7Ylra7RCMmN8D5lyCy9sjmv62f+DYj/AIK7+LvidqD/ALCH7QeqvqN9bwNP4bvbhy0rxRLmS3YnJOxV3Kc98Yr9av8Ag5D/AGZfDHx7/wCCaHi3xbf2iNqvgZRrVrc4HmRxwBjIgP8AdbjcPYV/nGf8E6PitrXwX/bf+GPj3QpjA9v4gsY5SDjdBLOiSr+KkigD/Tq/4L0/8opfix/15Q/+jlr/ADGP+Ccf/J9PwwP/AFHrf+Zr/TV/4LoalFrP/BI74naxAMJdaZbTL9HlQj9DX+V3+zt8V5fgZ8b/AA58XILY3kmgXi3aQg4LsgO0Z+poA/2T/i1+1R+zj+zjotnf/HjxtpHhSGWNAjajcLDu+UdAcmsP4Lftufsh/tG3zaZ8CPiNoXiu4UEmPT7pZGwPbiv82zWv+CdH/BYv/gq7d3/7X+o+HrnUrPWsz2x1C6+yr5A+4tvDJ1TH3cZz61+RHiTQv2jP2KvjPJ4d10al4M8XeHrgNsBeGRJFIKsvQMOhBxg0Af7VvXmvxE/4Kw/sh/8ABLT9rS40rQ/23fEth4W8Q2CFrK6+2izujGcZBOCXTHbpXn3/AAb/AP8AwVG1b/goj+zDNo/xSmWTx34NZbPUJOhukIzHMB1ztwGP97NfzWf8HdF1dW/7X3hNYJXQf2X/AAsQOi9qAP68v+CVv7OP/BOv9mP4d6n8Pv2D9ZsNfAZJNWvILoXdzITwnmyYBC5B2jtzX6unjr/hX8OP/BnHdXNwvxh8+RpMQ2GNxJ/5aP61+wH/AAX4/wCCt15/wTh+Blr4M+FMiN8RfGKOliWP/Hnb8hrkr1OCGVemGwfagD9jPjF+1h+zR+z4izfG7xzo/hdWGQdQuVjyB145PFeS/Dv/AIKUfsB/FzWU8PfDL4veGdbvpG2pBa3qs7H0AIFf5WnwK/Z7/br/AOCr/wAb7608DDUPGPiC8kM1/e3kzLBFuPWSRvkTrwOK+n/2uf8AghN/wUW/YZ+Hz/GPxhooudDswHubrSrjzXt+5Z1jJIVe7HgUAf6wkE8F1Es9o6yowBDIQQQemCKkr/PS/wCDeH/gtx8VPBHxm0f9jX9pbW5dY8K68y2mkXd4+6WyuDxHEGPVHbCgHkE1/c7+1z+014D/AGPv2ePE/wC0N8Rp1i03w5aNOQSB5khISJB/vSMo4oA9f8b/ABC8C/DbRZfEvj/VrXRtPgGZJ7uVY0UepJr4pl/4Kxf8E04dX/4R+X43eE1vt23yTfrvz6YxX+YB+3l/wUr/AGrP+Ck/xsn13xfqt7/Z1zctHo+hWjv5NvGzERoqL95yCMnue1fRWif8G9P/AAVQ1/4Sj42W3ghVsmg+1LbyXaJemPbuz5B/ebsdutAH+qH4A+Jvw8+Kugx+KPhvrVnrmny/cuLOVZEP4g0fET4nfDz4ReGZfGvxP1m10LSLcjzbu8kEcSZ6ZY9K/wAij9iX/goV+1h/wTS+PEeteE9UvrWGxuxDrOiXTuYp0jbDxuj5w2M4IxzX+hH+3lo3jz/gr1/wSFW//ZNtIr/V/G1nbXMFvJOsKpKpUzRGVsDKNuHbOKAP4dP+DhX4q+A/i1/wU28VeNfhZrlvrmj3FhYrFd2Uu+FiqNuAYdwetf0jf8GuP7XH7NXwQ/YS13wt8ZfHek+HdSl8TXUyW2oXIjkaMxxYYBuxIPNfxFftXfsr/Gv9jb4zX3wK+P8AZx2PibT4opZ4op1uFCSglD5ikg8D8K+wf2Jv+CP37ev7enwzuPi3+zDolrqWhWd69jLJNfx2rCeMKzDYxB6MOaAP9Xz4jar8EPiH8EtT1D4hXtjeeB9VsnF1czOPsz28i4LFiCMYPB/Gv5ovgL/wTD/4N8/hX+0Pa/GHwn4+0zV76K7E2n6VdasJrZJ2bKgRFcMAfurxiv0Q/ab+HHjP4M/8ET9c+G/juMW+s6N4WFvdIjiQLIiAHDjg8jrX+Xv+zRqepSftBeDla4lwdXtf42/56L70Af7KXxh/aH+BnwA0u1vPjH4r03wvFqCOLNr+YQiUxgZCE9cZH51/j9/8FBviV/wt/wDbR+IvxI+3rqS6prE0qXKtuWRRhVIPcYHFf6AP/Bxf/wAE5f2s/wDgoN8N/hjpf7LOmQalN4cN3Jfie8S12rMkOwgv97OxvpX+bN8RfAfib4Y+OdT+H/jKNYtU0md7e5RWEgWRPvYYdfrQB/dL/wAEhv2N/wDgidqH7H3gfxL8f9V8PXvxF1RxPdC/u1FxHOJv3KIhX5egGM8mv7SPDOl6Lovh6y0fw2qpp9tCkVuqfdEajCgdOMV/lm/sUf8ABCz/AIKU/G2y8B/tIfDfw/Z3HhG61C0vop21KKNzBDcKznyic5AU8d6/u/8A+CvH7cviT/gm3/wTyuPifoEaHxPOsGjaduO5I7yWNsOwHULsPpQB+j/xc/aW/Z++Alot98Z/GWleGYmyQ1/cLHwOvqf0r5v0D/gqv/wTc8VamNE8OfGvwpeXhbaIo75Sxb0xiv8AKk8E6T+15/wU1/abt/BdhqV94t8beKZmfN1OwXGfmZv4VRQeTgYFfqJ+0d/wbXf8FCf2avg/efGlorXWYNJtzc39vYyDz4UQbnKgMS4UZJwO1AH+n54e8SeH/FmlRa54YvYdQs513RzQOHRge4Irbr/LM/4Igf8ABVL9oj9jT9pTQvhzq1/f6x8P9evEstR02cvKsLSttWSPOdrBiAe2M1/qW28yXNvHcRnKyKGH0IzQBN14ziv5iP8Ag5L/AGoP2fNb/wCCd3jn4NaB4z0u58WQ3NosmlRXAN0rCeNiCg54Xmv6eBnOfSv8yv8A4Ltf8Er/ANtb4e/Hb4n/ALbXinR7eP4dXmpRyxXS3yPIVkEcanyAdwyxxQB+Zf8AwR28eeGfh7/wUw+EPjPx7qkWl6Pp+tCW5u7qTZFEnkyDc7HgDJxX+sZ8JP2o/wBnX4738+k/BrxnpXiW5tEDTRafOJWjU9CwHSv8aH9nz4G/Ef8AaS+MmgfA34QwJdeJPEdyLWwikkEKtLtZsGQ8LwDzX993/Buv/wAEo/23v+Cf3xg8Y+LP2o9Gt9MsNXs4orVob6O6LOu7OVQ8dRzQB/XX2yelfL3xj/bZ/ZF/Z7vDpvxu+I2g+F7gDJjv7tY2A+nNfzvf8HGX/BZ/xb+xpo9v+yp+zfei08a69a+ff6jEcvY2rkqAmPuyMVI56A1/F5+yN+wB+3d/wVM8a6nqPwrs7rxAY5S+oarqM7LbrI/zEGR/lLnOdo9aAP8AVG+E/wDwUC/Yj+O2rpoXwd+KXh3xHeynCQ2V4rsT9OK+vgyuodCCD0I5B+lf5H/7aH/BIH9v7/gmxpNr8S/iXpktvovmKE1TSrgyLFIOR5nlE7OnGTX9Lf8Awbd/8FrPiH8XPFsH7EP7UGqtqt60DNoOp3DfvSsS5MEjHrwMJ3yaAP7Ffiv8b/hD8C9Fh8R/GPxHYeGrC4kMUc99KIkZwM7QT1OK4H4Yftg/st/GrxGfB/wl8e6N4i1QRmU2tjciWTYDgttHYGv5z/8Ag7luLi3/AGHvCEkLsjHXmHykg/6oelfxFf8ABPX9tD4pfsc/E3XvGvwjguL7xZr2jS6NpPllnaK4uJYyHCcliFVgAO5oA/1hPjL+3Z+xt+ztqv8AYXxz+JegeFr08+TqF2sb8+3OK7j4MftRfs5/tFWUmofArxrpPiuGIAu+nXCzAA9M4xX+WV8Vf+CSf/BWHxn4Sv8A9pP4peC9X1Rb4Nf3Uk7tLeHf87MYMFwfbHFfBX7Nf7UXxz/Y7+MOmfFL4S6xd6Pq2jXKl4g7BHCt88UqdCpxhhxQB/tRVm6trOk6Dp8ura1cxWltCpZ5JXCKqjkkk18s/sI/tNaX+2H+yb4L/aK00Ki+IrFZJgDkCaM+XL9BvBr/ADxf+C/f/BW345/tNftTeKf2efBetXWj+AvB19NpYsbaRoxc3Ns5jlllIwW+ZTtxjg96AP7/ADxX/wAFSv8AgnP4F1NtF8YfGfwrp92jbWimvlVgfpivdPhB+1f+zT+0Apb4J+OdH8T4GT9guVk49e1f5mH7Fn/Bvt+3T+3N8HbX4+eHfs2l6Fqiebp819LukuV/vBSykKezd6+IPj58Av20v+CVf7R1v4P8WzXvhnxRprLdWN1ZzMY5Uz8skbL8rAke9AH+xjx17V/Of/wU/wD2Cf8Agjb+1p8al8RftWeNNP8ACfjuxjjjujDqIs55YcfIJkCnPA+U54r6H/4IVf8ABQLxn/wUA/Y5t/FHxShaPxZ4amXTdTlZSvntt3JKAe7KAWI7mv4VP+DkS/vof+CrnjVYZpEH2Ox4DEf8sz6UAf6Nf/BPH4T/ALGfwW/Z5tPh1+w3d2OoeD9PneN7mymFwZLoBfMM0oA3yYxnNfc5ZVG5iAPev5bv+DSaeaf/AIJsau87s5/4S3UOWJP/ACyg9a+Xv+Dj7/gtj4+/Z711v2Kf2XNUOna7LBu17VIGAmt1fpbp/dYrgknsaAP6gfi5+3h+xl8BdQbSvjN8TPD/AIbuU+9He3aIw/Dmqvwm/b8/Yp+PGqR6J8G/ih4d8R3chwkNleK7MfTnFf5TH7IH/BP39tz/AIKZ+MNQT4KaZc+IGt3332oX05SBHfnBlkJUseSFrT/bJ/4Jt/tx/wDBM/WdO1H42aXPosF0+bTUtPuDJAXU5A82M7Vb0BNAH+wcro6hkIIPQg8GvPPib8Xfhf8ABfw6fF/xY16z8PaWrbTdXsgji3HtuPev40/+Db//AILc/EX4reM7f9hv9qjVW1S7lhZvD2q3LfvT5S5a3kbo3AGzoSTX6Uf8HS0s1v8A8E07t4WaNv7Sh5UkH7y96AP2t+Hf7aX7Jvxc8TReDfhj8QtE13VZwTHaWdyJJWA64UU341/tqfsl/s33S2Px5+Ieh+E5nAITUbpYmIPtzX+SV+wR+2F45/Y4+OP/AAuDwNbzajrq2ktrp0YZmxcykBW285x2HrivsL4lf8EsP+Cuv7Q2i6l+1H8SfBusaydU338z3Tsbtg3zcW5G7p0AFAH+oT8Ff2uP2YP2jg7fAfx5o3iwRDL/ANnXKykA8cgYr6Jwelf4nXwi+Nnxv/ZU+Kln45+G+q3vh3xDoNznarNGVeNhujkQ44OMMCK/1wP+CW/7Y6ft2/sVeC/2hrgKmo6nbmG/QdRc27GKRiO29lLD60AeueOv24f2QPhj4kn8HfEH4j6Fo+q2pxNaXV0qSof9pSOK9Y8L/Gz4ReNfAjfFDwn4jsNQ8OqGY6jFMDb4UZJ38dBzX+Vp/wAF8b69i/4KffEJI5pFAlTADEDq3pXQfCj4u/t8ft0/s0+F/wDgn9+yRpGqXGheHVNzqptGdY55n4BnlAwijHygnnmgD/SFb/gqZ/wTlTxGfB5+NHhX+1FbYbb7cvmbs4xjHXNfbvh/xFoPivSYdd8NXkN/ZXKh4poHDo6tyCCCetf43v7WP/BPz9sX9iS5tbn9ovwteaHHfHEF7kyQsw52iZfl3cdM5r9zf+Daj/gqF8Vvg7+1Vo37IHxD1mfUfBvjaQ2tnDcyFxaXhG9XRmJwpAYEepoA/wBI6uS8Z+PPBfw60ObxN471S20jT7cbpbi6kEaKPUk15h+07+0L4J/ZZ+A/iX48/ECYRaZ4dspLtwWwZCi5VF9ST0Ff5Uf7eX/BSj9rf/gqN8f3S6v76TTby8+z6J4fsWcRorNtQBE5Z24zn16UAf6acn/BV/8A4JrQ61/wjsvxt8Ji+3bfJN8u/PpjFfafgX4i+AvidoMXij4eava61p1wMxXFpKsiMPYiv8w3Rf8Ag2c/4Kk658M1+Jsfh+0huZIPtK2Mt4guSuN2CM7g+P4SM5r48/ZC/bt/bL/4JQftKtawXuoaa2lXgt9b0G9Z/KnjRtroyNz0BIIxmgD/AF3r3/jyn/65v/6Ca/xcf22Sf+GtfiAP+o3d/wDow1/sC/suftI+Cf2tv2b/AA9+0B4AcNp3iTTFugm4MYmePLRvjoy9xX+Pz+2z/wAna/ED/sN3f/oxqAP9Ur/git/yjO+Fv/YN/rX6a6/4k8PeFNKm1zxPew2FnApeSadwiqo6kk1+Xf8AwRq1G20j/gl18NtWvOIbXSGmf/dQFj+gr+AH/gtV/wAFYP2gv20/2nvE3w/s9budN8B+G9Sn0/TdNtZGjjkELmMTvjBLPtBx0oA/0WvEH/BVj/gm34U1RtF8SfGzwpZXSnaYpb5QwPpjFfSPwi/aX/Z9+Ptq198FfGWleJokGS1hcLLgfzr/ADR/2V/+DcX9vn9rP4Mad8eNPFnpGna3ALrT0vJQZp4m+6xBYFM+9fnb468Iftsf8EsP2oP+ES1G6v8Awp4x0CZZYTbSs0Uyg5DLj5XRhwcfSgD/AGOj1or8tP8Agj5+3Hrf7e/7F2gfF3xtamz8SW4NlqkZUrumi+US8/8APTG78a/UugAooooAPev5sv8Ag4f8Q6jaeEfh54etpdlvdXN3JKvYmNY9v5E1/SaeVIr+ZH/g4njY2Xw0x0Et9z77Y+lft/0eYxlxVh1LXf77M/HfHtyXC+I5d/d2/wASPCvgB4r/AGmvhH8PPB8un+GtG8QWFrotsljeCMW19BBqV3Ja+SLkK5Zg5LMcDCnNflD4v+HHjf44ftM614H0O3jg1WS9liZZ7kypG0ZIbMxUZGQecV+kfw0+Pem/Bf4OaM3iC58exC302G8f7Bewx2qwSTNFG6B7Z9qGQEDk85r8X/GXiibX/HGq+KLGe4U3t3NOkkr/AL4iRywLsoXLHOSQBk9q/tbw/wAtxDxOKqxjGLaspJbvXVpNr8j+NvEPMMP9Ww1JylNJpuLe2i0Ttf8AFn2TrH/BNX9p+0s3u9A06210xjJj0yZZ3x/u4FfH/jf4Y+P/AIYa3/YPxC0a60e8258q5TY2PWsix8aeLNJu1vNM1O6glQ5DpM4OR+OK9Q1L9o34o+IreCw8c3v/AAkFvbjEUd+BIEHcLjBr9Ly7DZlRqWxVSM4d+Vxf5v8AQ/K84xWXVKd8HRlCd+srq33b/P5n65/8ECZ5Zv2lfENjcOXiTSVdVJyoPm4yM1/YIlvAJRJsG7IycV/BX+x98ftQ+G3xAv8AxD8JopPD+qT2ojmkgYbGUt0C44596/Sg/t8ftUSLuj8VXKAcHLDk/lX87eKP0dM04jzmeaYavFRaSs73ulr0P0ng76XuS8JZdHJcbhZyqRu/d5WmpO/83be/QxP2uta1K3/aR8WJb3EyompTAhWIUfMcYr9V/wDgk/eXepeANbfUHMh+0DG454r8GvF/i3XPHfiC78U+Jbhrm8u5DLNI5yzMxyT2r1T4Y/tFfGD4T2M9j8NNXm0uCU7pEiYDcRj1HtX7L4j+F1fOOGaeTUJRjUSjq7293/M/knwg8ccLkXGlbiDExlOlJztBbtSfbVaJd+/of1h/E3T7H/hWXiKIxLs/s27YjHGfJfmv83/xNq2rad4r1IWNzJADcy/cJHG41+/2rft0ftM6hpV3ZS+KL545IJVdS4OVKHIPy9Oxr8OtQ+Jun6pfzTeJdCsrkNIxZ4wUkJz1Jyf5V8l4MeEON4Up1qeMqKXtGrWvpbuf0f4lfSBwXHTp18rw7SpXTva+ttjx+a5vL0h5ZHlJPVsk16z4A+APxi+JOm3viDwdoN1dafp0TzXN1sIijSNdx3McdhXt3w//AGkvhd8NNNMnh/4caVqWqKdy3Oqhp1T0KqpTmub+M37ZHxy+NliNB1vUlsNGChU02xUQWy49AOT+JNfpmJxOZzrOlSpRjDrKTu36RS/Nng4LA5bHDxq1pyc39lK3/kz/AETPf/2DviHp/gvQvHU2ralq8cVnp4vItN0i9eylvpRIkfl70Vz91ieh4FeOftLeNtA8f6zputeHvBmoeFlgZhLNf3z30lwxIKku8ceCMH1zmvb/APgm9beNJJPiPL4H1aDQb6Xw8sEWpTbMWzvdQbWG/jLH5fxqP9tjwX+1n4S0m0s/jp4vt/EenC6kijEM8MmyaFsMGWMZUgnBB6V+fqrQhxBVptpSbsrylf4Volbl+9n6fTp4iWRUaii3FdlG3xytdt82nkuh/Yh+wxr0/ib9kfwDrly297nSomLHqcZFfWFfEv8AwThikg/Yd+GsU33l0eP+Zr7ar/NHieEY5liIx2U5fmf6J8OTcsvoSfWEX+CP/9P+0CiiigAooooAKKKKAMzW0MmiX0a9WtpgPxQ1/ikftKeHr/wp+0L4w8PaojJcWmrXKOD1B8wmv9sllV1KP0IIP0Nf5bP/AAce/sM+JP2Vv2+Ne+Jen2bJ4X+IcrapZzqp8pJnP7yHPQFQAfxoA/vJ/wCCIfjHR/HH/BMH4Vazo0iyRjTTE208q0cjKQR26V+r1f53v/Bul/wW2+HH7JGj3H7JX7Uuof2d4XvLjztK1ST/AFdq7YBik/uoTkgjua/uKP7ef7HB8KnxqPiNov8AZQTzftH2ldu3Gc469PagD5a/4LheMtJ8Gf8ABLD4yvq7qg1Lw/c2EO4gZmnQhQPc4r/Ke/ZP0i7179p34faJYqWmu/EOnQoB3Z7hAK/p9/4OMP8Agtr8Ov2vdGt/2QP2XL7+0fCdndLdatqsf+ru5ov9WkR4JQZbPTPFfCf/AAbk/sLeIv2rv28dG+IeoWTv4W+H7rql5clcotxGd1uoJ4z5ijPpQB/cH/wWvsJtL/4I3/EDTLkYkttFsomHoyPGD+or/MO/Yo+GOlfGX9rPwD8MNcGbTWdZt4JR6ruyR+lf6jn/AAXqx/w6m+LBHQ2UP/o5a/yp/wBnb4q3fwP+Onhb4tWS7pNA1GG7x04Rvm/TNAH+1j4M8M6J4O8JaZ4X8O20dpY2FtFDDDEoVEVVGAoHGK/hS/4PC/gZ4T0Lxj8Nvj9pdtHDqmsrLpd06KAZBCrShn9T8wGT6V/Zj+zF+1r8DP2nvgloXxj+GniGyudN1K0jkO6eNXicKNyOpbIIPWv4Lf8Ag6n/AG6vhr+0d+0F4b+AHwo1GLVrLwLG8l9cwMGQX0u5WjBHBwm05oAof8Gj3j7VtA/bw8TeEkkY2ereHnDx/wAO9ZkIbA744rrP+Du3/k7/AMJ/9gr+i1uf8GhXwS1rXv2qfG3xungb+ydH0f7AsuDt+0yyI4XP+4Caw/8Ag7u/5PA8J/8AYL/otAH2J/wZudPjEPWGw/8ARrV+QP8AwdBfE/W/HH/BUnxH4R1KVntvClpbWNqpJwiSRJOQB2+ZzX6+/wDBm7kL8Yj/ANMbD/0a1fmZ/wAHVPwC1/4bf8FFZPizc27/ANneOdPiu45wDs8yFRAUz03Yjzj05oA8f/4JP/8ABcuH/gl38IdU+Hnhr4f2et6hrN19our+UlZGC5CLkMOADjHtX6PfFP8A4O1Na+LPw61r4aeKPhVp8+n63aS2k6O7MCki4OQWwa6P/g2h8Cf8E7f2l/hL4g+C/wC0V4X0TUfHOk3Qntm1JI/NuLaTJJQuOQhIXiv6XvjR/wAE/wD/AIJGfAD4a6r8Vvid8P8AwzYaPo9u9zPI0MG4ogyQox8xPYCgD/Kp+GPjafw98d9D+IOjgWklrrcF9CF48srOJFA+nQV/eV/wdDfGvxJa/wDBLj4RaTZzOD40u7FtQ5OJIzp4uAD6/vFB5rn/AIbft4f8G3/j/wAb2HhHw38NYYdSvbyO1tRJpsI3zO4RNuCTyxGPXNfT3/B0T+zrdfFr/gmVoHjnwBYuLP4fX9tqZijXmOzkhFqi7R0C+YPpQB/JV/wbsfBDwn8bv+CnXhCz8YW0d3a6CkmrLDIAyM8BVRkHg/fzX+rSESNBGowoG0DsB0xX+Q9/wRf/AGuPDP7F/wC3/wCDPix45lFvoM032DUZz/yyt5yMvj0DAV/rJ6f8afhRqngaP4kWPiHT30WW3+1rdfaI9nlFd27r6UAfhx+1D/wbbfsM/tUfHTxB8evFVzqWl6j4jn+0XMFiI1hWTaFJVe2cZNfrL+xJ+yB4B/YW/Z90n9nL4YXlzeaJo8k0kD3ZBlHnuZGBI7Aniv4//wBsP/g7A+J/w0/aQ8VeAv2fPDOma74T0i7NtY6hLMQ04QAO2AhGN+QMHoK/qo/4JbftQfFf9sr9jHwt+0X8Y9Ii0PV/EJnf7JCSVWFJCsbZIX764PSgD/PD/wCDl8n/AIew+Lx/1DtP/wDQGr+pj/g0WP8Axrw8Qj18V3ef+/UNfy2f8HMcEsP/AAVj8XCUbS2m6cwz6FGwa/pf/wCDR/4i+BrL9hjxR4OvtVtbfUrbxJcXMkEsqRsIpI4wrYYjgkEUAfuR/wAFbAD/AME7vikf+oPLX+Sb+zH/AMnCeDf+wva/+jBX+th/wVqdH/4J1/FCSNgyto8hBHQgjg1/kn/sx/8AJwng3/sL2v8A6MFAH+1zH/yA1/69h/6Lr/GJ/bvY/wDDYfxF/wCw1c/+hV/s7R/8gNf+vYf+i6/xh/28P+Tw/iJ/2Grn/wBCoA/1J/8Aghxz/wAEvvhYP+nGT/0Y1eN/8HBf7FHj/wDbe/4J/an4N+FcDXev+Hb2LWra1T71x9nRwYl92DfpXsn/AAQ4/wCUX3wt/wCvCT/0Y1e3ft2f8FG/2d/+CeXhfTPF37Q0l3DY6vIYYHtohIC4/hOSME9qAP8AJm+Avxx+P37An7RWn/FTwSk/h7xb4dlZDFdxMjbScSRujgHa4GDxX9U/wZ/4O/PHkumLoH7SPwzstTtXjMNy2mMxaZGG1gyzNs+YZyOlfqX4E/av/wCCE/8AwWH+OTfBm+8HRN4ovoZLhb68torKSfYPmAuFYszemfWvB/8AgoN/wbIfsF+G/gX4q+LfwN1u58FXmh6fcaii3Vz9pgkMEbSeXmRxjfjAwO9AH33/AME8/wDgqb/wSS/bf1628H/D7wrofhHxbMQ8Om6lp9pHO7jnKSrGFJB6YbNf0MIqogVAAo4AHT8K/wARL4ZeIvEXw/8AivoniDwjePBqOm6lA1vPAxB3LKMbSMHB6e4Nf7P37M3inxD42/Z68F+LvFoK6pqOkWs90GGD5rIC2fegD3Gv5/f+Dmbj/glF40H/AE3s/wD0oir+gKvwB/4OY4pJP+CT/jZ0UkJNZFvYfaYhQB/At/wRDP8AxtY+Cn/YeH/omWv9eJn8uAyf3VJ/IZr/AB/P+CNvinw/4J/4KcfB3xT4puo7LT7PXFaaaUhUQGKRQST05IFf6+Gl61oXiC2J0a9t7tSgyYZFkwGHGdpOM0Af5FP/AAWq+J2u/FP/AIKa/FjxDrMzSLFq7W8CsSRHFHGoCL6DOT+NfpT/AME2f+DiT/h3X+y7pH7O3g/4bWOoS2Uk013qDMyy3UksjOGfDDJVW2j2FfD3/Be/4BeIPgL/AMFOfiJa6pA0Nl4gvBqmnuwwJLeRQmR6/OrCv6bv+DeT4Of8Eyf2wP2KtN8JfEzwfoGo/EXwtLPDqxvI4/tEyyTM8Unz8sBGyr9aAPzc/a6/4Oh7/wDa3/Z18Vfs9+MPhfYLZ+JbJ7UylmYxM2MSLljhhjrX8/3/AATg8d6p8Pf28fhZ4q0OVoHi8SWIIU9Y2mUMp9iOK/0l/wBqv9kb/gjX+xx8HtU+Nnxq+H/hy00rS03GOOCBp5m7JEmBuY9q/Nf9lz9tD/g3v+Mvxq8MeC/g38OYbTxVqF/DHpnmadCjrcMw2NlScYPftQBu/wDB23d/2h+wX4IvsY8/W/M9vmhBr+WT/g3O+G3hP4k/8FSfAtv4vtY72DTGlvI4pVDIZFUqCVPBxnNf1R/8HcsKQfsK+DYI12rHrpUD0AiGBX8zP/Bsl/ylN8L/APXtP/SgD/UluraC5s5LKdA0UiMjKRwVIwQR6V/jz/8ABXfwV4e+HH/BSf4weCvCdulpp9hr8qQxRgBVBVWIAHHUmv8AYhP3T9K/yCf+C2H/AClS+Nn/AGMMn/otKAP9AX/g2tuJb3/gk54Dtbli0cbXaqD2BuJc4r+Gv/guP/wT5+NH7JP7bPjbxhrekXNx4W8XapdazY6nHGzQYu5WlaNnAIVkL4561/b7/wAG32qW2if8EjfCGs3gJitEvZnCjJKpNKxwO5wK8c/aN/4OFP8AgkN4nbUvhB8c9IvPE0NpcPaXNndafFOiSoxRvld+CpzQB/Kj/wAE8f8Ag45/az/YO+F+l/A0aTp3i3wtpIEdpFfb1lt4hjCRmMrnGOM1+73wh/4OeP8Agnv+0D4psI/2ufhXHY6gAsI1S7tLa9ghQntvV5AATnivuzT/APgiN/wRr/b++Eul/HT4U6C2nWniK2W8tZtOvDAIhIMgPDGQoI9D0r+Jj/gtF/wTj8Af8E2P2nLf4U/DTxSviTS9Sslv4lbb51sGYr5Um0t6ZyTnmgD/AFMv2aPGX7OHxJ+G1p8RP2Yv7Jfw7qwWVJdJiihjc4/jWMDDAdmGa/zJf+Dkj/lK741/687H/wBFmv3W/wCDPb4pfEXUrH4jfCq+uJp/Dlp5d5CshJSKc7VKp2GQScV+FP8Awckf8pXfGv8A152P/os0Af1if8Gkp2/8E0dZb08Wagf/ACDBX8Gn/BRn4l638W/23fiV471+Vpbm51u5jLOSTiFjEoyfZa/vM/4NJBu/4Jp6wvr4t1AfnFBX8Qv/AAV0/Z+8Qfs3/wDBQT4j/D7Xrd4VbVJbu3dhhZYrj95uU9xliM+tAH+ih/wbz/Avwn8GP+CZXgu60S2jS+15ZL69uFADzM7ZTce+0HArtv8AgvX8EvC3xm/4Jc/FGXxDbxyzeGdKl1qzd1BKTWwyu0np1r4v/wCDaL9uj4Y/Gv8AYV0r4FahqtvbeLPBDPBc2ssio7wuxMboGIyAuAfeu7/4OOf23/hl8BP+CfHin4RLq1vceI/iDbtpFtZRSK8pglGJZSFPCpxnPrQB/nJ/sM+Ota+Gf7Yvw08Z6FK8NxY+I9OfKHBKi4Tcpx1DDg1/oS/8HO2qNrf/AASvj1lxhry5tZiPQyCNj/Ov4Iv+CYnwO8S/tD/t3/DL4ceGrdrhjrtndXO0Z221tMskz/8AAUBNf30f8HQumw6N/wAEvG0e3OY7S9toVPsmxR/KgD+Iv/ghv8OfC3xQ/wCCoPwp8NeMrVL3T/7WEskEgDI+xGIDA9RnFf650dvBFAtmihYlXYFHACgYx9MV/k1/8G+n/KV/4V/9hE/+gNX+syepoA/ySP8AgvZ4D8NfDr/gqr8WNE8JWqWVm+pLMsEQCoheGMsFA6ZOT9a/tS/4NUbue4/4JuRQSsSsOqzqgPYGRycV/G//AMHEv/KWj4p/9fsf/olK/sY/4NS/+UcH/cXm/wDQ3oA/jF/4L7f8pQPiF/11X/0Jq/sh/wCDT/4Z+EvDX/BOu88fWFpGur6xr1ytxdBR5jRokZRN3XapJOPev43v+C+3/KT/AOIX/XVf/Qmr+2H/AINYf+UXdt/2H7z/ANAjoA97/wCDjHwB4W8a/wDBJ74jX+v2iT3OkfYrmzmYAvDJ9qiBKE9CVyD7V/m+/wDBMK6nsv2/fhXdWzFXXXIcEdeQwr/S1/4OBP8AlEv8Vv8Ar3s//SuKv80L/gmX/wAn7fCz/sOQf+zUAf3d/wDB118UNd8I/wDBOzS/BejytCuu6zaLOynBaNA25D7Nmv4Of+Cen7Wmi/sRftP6J+0brHhyDxT/AGGsxhsbn/V+a64STqPmQ/MPcV/oIf8ABz/+z/r/AMY/+Cab+KvC8DXF14Tv7XUJgozttUVjK34cV/Cv/wAEd/Fv7NXhT9vDwlF+1ppdnqngvUjLZXMd8oaFJZ12Qu24YAVzmgD+iw/8Hi/jj/ol9j/38f8A+Lr+Zv8A4Kbftx6b/wAFCf2mbz9pCDwzb+F7vUbaGC5gtvuyPCgTzDyfmbGSe+a/06tO/wCCWX/BLjWNLi1nSvh14YntJ0WSOZI4CjIwBDA46EV+KX7Sf7Tn/Buf+zB8btT+BPjn4fadfappJVbm40+wgmtldhkp5mRlkPDDHBoA9c/4NRviJrPir/gnBqnhTVpTMujazerCW5Kxuq7UHsuOK/z/AH9tn/k7X4gf9hu7/wDRjV/q5f8ABNLxf+xj8Sf2cLn4h/sOaDHoXhC9uLhCkcCwB5kX5m2rwevWv8o39tn/AJO1+IH/AGG7v/0Y1AH+pp/wRz0qPXv+CWPw60OZtqXmjSQMfQSAqT+Rr/N4/wCCsn7Bfxu/Yq/a58X6Z440e5TQ9R1O4vdL1JY2MEttNIXjzIBtDhSMgmv9Hz/gj94jsvB//BKf4feLNTDNbaZosl1MEGW8uEF2IH0Br81fjz/wcNf8EZvjHpLeAvjPod54ts95i8m60+KdY2Y4JG9xtx69qAP5vP2EP+Dm79rj9j74YaL8EvEuiab4x8O6HCttavdF0uIoF6IpQgNj1av2++B3/By1/wAE1/2i/GVmP2q/hjDo2sShYTq2oWdteQoCem4q8oGea+2/EP8AwQB/4JAftg+ArP4q/C7Sn0yHW7cXVpeabelYlWQZBMKkLx6Gv4RP+Ctn7Cfg/wD4J6ftZ6h8CfAviVfE2mJELmKYbRJEGP8Aq5ApYBh9TxQB/rO/AvWvgj4r+Hll4y/Z/GmN4c1VBPby6VHHHBICMg4iAAYZ5BGRXsNfx7f8GgnxV+I3i39mf4h+AfEk01zovh/V7ddOMhJWETRF3Rc9i3Nf2E0AFFFFAABzk1/Pl/wcD/DK91/4G+F/ibbg+T4evmilPvdhVX9Vr+g2vhv/AIKNfBR/jx+yD4t8GW6mS4t7Zr+3QdWmtlLIo+pr9H8Jc8jlvEeExUnZcyT9Hofn/inkrzDh/E4VK75W16rX9Ln8jfhj/gpH4w8K/CzSvhtb+EdHuZdL02PSzf3HmSSzQRTvPGHRiU+V3JHFfn34w8U3njTxPeeJdQjjilu3MjLEoRAT2CjAAq34W1a08IeLI7rX7Nb2O2dklgfoSMgg/Q1Q8QXSa5rd3q+l2fkQOxYRxglUU/y/Gv8AUrKuH8Bgb1cLBRct/M/y/wA34lzHHNUsZJyUbWvbotVZLy/rr2Gn+O/DNrYxWd14as7gooDu0kgZj68NgE1oQ3Hwn8RsI7y3m0OQ9HiPmRe2c/N+VV/gbdeHrL4veHJ/FsKT6Yb6L7QkuCjIWwcj0Nf1MftDf8EOvg18WbBPHHwN1N/Dd5dxJP8AZj+8t3LKDwSfkHsor5LjPxVy/IMXSwmY3jGorqSV0mnbXr+Z9Lwd4L4vO8HVxmWu86bV43abv67+h+Tv/BLv9j3wt8efjPrGjatrymxhsRJHJZ43k7wPmV+34V++x/4JH/CZgAfEF/1/uR/4V/Nn8HPid4l/4JefteNefabfxDbW4NrqK2pbbJFzlVLKPmQnOB1Pev60v2Zf+ChP7Of7UOh3WseCdSa0l063+03sF2NjQRjqz9QAD71/P3jPxLxbhsVHMMnrT+qTUbcr0T03Vr3b8j9n8KPDfgvG4eWBz/D054yDkpOas2k9LatWSsfzr/tC/DHTvhB8V9T8B6XJJc2+n3DxJJJjcwB9BX2X+xV+xB4H/aW8E3vibxHqd1YzWtx5QSFVIIwDzu+tfL37WXirQ/HHx113xr4Pu1v9Murp2t7mLLRyZJ+6e/vX6j/8Ev8A4peBvC/h+6+HnibU7ez1/U7h5rayc7ZZUjTczKvsBmv2HxZ4nzfCcGUsVgako1nyuTXxed1+fY/kPwC8PshzDxIxOX5nh4yw8XO0ZL3e0XdW7e6uq1Ro+Kv+CUPwt0Hwpq2rW3iK/U29lcSYKR4OyNjzx04r+QzxD8Hy+tXUeiavZ3CRzOmNxUjBPUNiv6jf27f+CyXwf8EeENf+FXwYEms+Ip45rB5wAtvATmOXLdSwGRjFfjJ+wr/wTK1v9tuzl8Yv4nt9OtIZh9qjCM9yu45B2sAp3YyCGr47w04xzbK8qq5rxnVajJrl5tX9y7+Z/TPiD4a5Pi8ypZRwRSUZJNzULKO+/vL8vM/Pz/hW/h7RQLjxbrkEYx/qoAXkPsOqj8TXK+K9S8G3UcNh4VsWt0hzunlYmSX6gfKB9K/ou/4KG/sIfsy/sT/sUXMPhaE3nirUr60Rb25OZXVGJfy1OdgORkA1/M9HFLI22BS5PYDJP4V+zcDccYfP8C8xw0HGF2lfS6XU/KONfDzEcP46ODxU+edr2Wyvr06nY+FPiH4y8GWd/pnhm8e1h1FUS5VAD5gjdZFBz6OoP4V0fiH4qfEb4o3Nro/i2/e+DXstyoZQCZ7pw0rHAydx59qyfAHizSvB9zetrulRagZ4GiVZh/q2PG4e4r6E/YK+DV/8ef2q/CfguztfOtvtiT3g7LBGfnY+wyK9LibEYbA4KtmFSKvGLd+ui7+hzcJfXMZj6WXQb5XJK13qm9dPLVn91v7K/gyb4e/s6+DvBtwmySw0yGNgexxn+te/VWsrVLGziso/uwoqDHooxVmv8fsbiXWrSqvq7/fqf63YPDKjRhRW0Ul9ysf/1P7QKKKKACiiigAooooAK+Jv28/2DPgd/wAFB/gZffBP402YdJAXsr1B+/s5/wCGSM9cZ+8O+K+2aKAP8tH9uT/g3I/b6/ZV8TXt18NdAn+IvhnezWt1o8bTXXl548y3QMykDqc89a/Kz/hij9uBb06Gfht4sFxnb5P9n3W7PTG3bX+0AQCCp6HrWSfD+ged9o+w2/mdd3lJu+ucZoA/y6/2Gf8Ag3F/b6/as8S2V58TNBn+HPhgupurzWInhuxGT/yztpNjOSM/xV/oq/sIfsG/Av8A4J8/A6y+CfwRsRFCn7y8vJADPdzkANLI2MknFfaw4AXsOlFAH5Z/8FqPhz4++LP/AATS+JngD4YaNeeINc1CzhS2sLCFp7iZhMpISNfmbAHav85L9kv/AIJE/tt+Lv2kfCHhj4y/BXxlYeF7/UEh1G5uNJuYoooXBBd3ZAqhTg5Nf63QJByKcZHPBJ/OgD/LE/bj/wCCNv8AwUc/YK+ImreHPg/pfiDxJ4GvmJtb7Q0nmQwt0W4SLd5bDoQTmvkz9mb/AII5/wDBQ/8Aav8AH1v4Y8PfD3WNKt7iQfaNV1m3ltbWNSfmYyyKAzAc7c81/rzTwQXURguUWRD1V1DD8jUdrZWdjGYrKJIVP8MahR+QAoA/Oj/gl1/wTs+H3/BNn9maw+C3hNlvNUuMXGsX+3a1zdEcnv8AKuSq8niv4yP+Du3/AJPA8J/9gv8Aotf29/8ABRb9rK9/Yd/Y88ZftPadpi6xN4XtknW0Y4Em+RY8E5H97Nf5YH/BTX/go98Tf+CmPx7Pxp+IGn2+kRwQJa2lla7tkaKMZO4tlm789aAP6h/+DN77nxi/65WH/o16/pY/4Ko/8Eyvhd/wU2/Z8m+F/i910/X9OZrjRdUChmt7jbjDDglGHBGR1zX4v/8ABpl+yt49+EX7Mfiz45eN7GXT18aXKR2UcylGktoMOswBwdrFiAfav63OepoA/wAlX9oH/gjt/wAFPf2GfiU9xpPg7Wr8WEpa11vw5FNcxFR91zJEpCkjnBJxXmXiH4Vf8Fb/ANqMW3gbxboHj3xZEGCpb3FtdSop6DI24wPev9fG4t4LqIwXUayoequAw/I5FUrTRNF0+TzrCzghf+9HGqn8wBQB/Eb/AMERv+DcL4hfDL4m6P8AtV/tvQRWcukOl3pPh8EO4mHKS3P91kbBCFeCOtf2n/Eb4eeEPiv4E1X4a+OrJL7R9ZtntbmBwCrRyDHQ5wR1U9iK7YnPJooA/wA1H/gqH/wbW/tRfs6fEDU/Hn7Jekz+OvA91K81va2SGTULUMSREYV3M4QcbwBnHSvxrT4Bf8FJrDR2+FcXhPxtFZMdh077JdhcnjGzb+lf7IXYjsetZB8PeH2n+0tYWxk67/KTdn64zQB/mo/8Evv+Db79qr9pj4haZ41/ak0W68CeB7SZJrqHUY2ivrpVOTGsDhWUOON3PXpX+kd8Nvh14T+EngLSPhr4FtVstI0S1is7SFcYWKFAi9OpwBk967ccAKOAO1FAH8c//Bx1/wAEUPjJ+1t47tv2xf2X7IaxrsFlHZ6tpSf66aO3UCJ4QMl2Azlcc5r+NLw/+w7/AMFHPA3iBtH8OfDLxtp1+XCNFb6fdo7EHoQF5r/ZFqk2m6a0/wBpa2iMn9/Yu788UAfjZ8W9F+N3xe/4IwXfhrWfDOpf8Jrd+FY7R9IMDm+M0cYjC+VjcWOM4xmv87/9nv8A4Jg/8FFNC+OPhTWdV+CPjS3tbbVLaSaWTR7pERFkBLMxTAAHXJr/AF4AT1p/mP8A3j+dAGXHG40cREHd9n24752YxX+TR+2b/wAEzf8AgoT4s/an8d+JfDfwV8ZX1heavcSwXEGkXTxyoWyGRlQgg9iK/wBainiRxwCfzoA/Mb/gjt8P/HPwt/4J0/DjwL8SNHvNB1mws3S5sb6JobiFjIxw6MAVOOxrtf8AgpT/AME//h3/AMFHf2ZtU+AnjmQWVy5+06ZfhdzWt2gISTGRkcnIyK/QEnPJooA/yZf2j/8Agiz/AMFNf2JPiS11ofgzWNZh06cyWWteHYpbpQqnKOzQqdh46EmuJ8Uxf8Fn/wBobRF+FfjC0+IvibTnIiGnzW91JH7Art6fWv8AXLmhiuYjBcKsiN1VhkfkeKz7bQdDspfPs7K3ifrlI0U5+oWgD/Pz/wCCRP8AwbR/G/xd8TdI+On7cNgfDfhrS5kvIdFc4vLqSM7lWZGAaIAjPIOa/wBBbT7Cz0uwh0zT41igt0WONFGAqqMACrhOTmkoAK+Rf27v2U/D/wC2z+yl4v8A2a/Ecggi8RWmyKUjOyeMiSJvoHVc19dUUAf5DP7Tf/BGn/goh+yz8Q7zwrq3w71rWrW2lYW+q6PazXNtKoPysJI1IUkc4zxX9Pn/AAaw+Cv20vhT8UvHeh/Hzwl4l0vw9rdlA0F7rNtPFAsltvISNpQBk7sYFf2x3NrbXieVdxrKo7OAw/I0sFvb2qeVbRrEvogCj8hQB+I3/BZz/gjp4G/4Kf8Awug1DQ54tF+IWgRn+y9RZRtlXr5E3I+Q5OCT8pOcHpX+fT8Q/wDgmp/wVQ/YV+JE0mmeCvEtheWTkR6toMM81s4BwCs8S7Tkc4r/AF1arXVlZX8fk38KTp/dkUMPyORQB/kKal+zf/wVp/bI1yz0HxX4W8ceLZA4RGvba5eKLPdmK7VUdyelf2Lf8EJP+DfjWP2OfE9t+1T+1gYLjxqsRGm6VERJFZCQcySP/FJ6DAKkd6/rPstK0rTTnTrWG2J6mKNUP6AVfoA/mY/4OiPgD8cP2h/2OvCvhb4E+EtV8Yalb6200ttpFrJdSpGYwN7JGCQM+1fz1/8ABvT+wb+2n8Df+CkHhzx78YfhX4o8MaJBbzLLf6nptxbW6E4wGkkUAZr/AEfAxXlTilLueCSaAGkEqQOuK/y1/wDgrp/wTo/bz+KH/BST4vePvhz8HvF2t6JqeuyTWd9Z6VczW88ZjQB45EQqykg8iv8AUopwdwMAn86APxF/4N+vhB8Tvgv/AMEzvCHw6+M3h2+8N61bvcifT9Tge3nQNPIRujcBhkHPPav58/8Agtl/wbhfFvxF8W9a/aj/AGIbNNYs9dmkvdU0IfLcRXDkvI8AGTJvYk7QoIzX94pJJyeaQHHIoA/yH/AXhj/gsd+yhbTeAPh3pXxC8GwMxD2lta3UKknj7uzvXefBv/gkd/wVR/b0+Jw1fxJ4Q12KfUJR9q1vxLHLbR7T95vMlUBsDnHev9ZG60TRL+Xz76zgmfrueNWP5kZq9Bb29rF5NqixoP4UGB+Q4oA/Lb/gk1/wTE+Hn/BMT9nxPhtoE/8AaXiHVmW61rUCuPNuAuNqDJwig46nOM1/FT/wX4/YE/bb+Nn/AAUu8XfED4Q/CjxT4l0O5tbJYb/TtMuLi3dkQhgskaFTg8Hmv9KSnB3AwCRQB/N//wAGwfwH+NP7PX/BP/VPA/x18K6p4R1iTxPfXC2erW0lrMYnihCuI5FVtrEEA+1d1/wW5/4In+Fv+CmPg6D4h/DqeHR/iVoUJjtLiQAR3kQyRBKcjHJJDEnHpX9ApJY5JzSUAf5A3j3/AIJxf8FPf2M/iBKi+A/E+l3to5RdS0i3nkt3wcZjnjXawNVvCP8AwT7/AOCn/wC2V4+gjuPAvirWr65IjOoarb3CwRjt5k0i7VFf6/F5YafqKCPULeO4UdBIocfkQabZadp2mqU063jtweoiQIPyUCgD+dr/AIIcf8EN9D/4Jt6HL8YPi/NBrHxN1iDy3eMBodPiYfNDC2TuY5O5xjI4wMV2P/ByD8FPi98ef+CfNz4I+CnhnUvFesNfxOLLS7d7mfaGXLbIwTgV/QBSgkHI4oA/zKf+CHn/AAT5/bj+D/8AwUv+Gvj/AOKXwk8V+HtDsL4vdX9/pdxBbwrsbl5HUKo+tf6a2cnNKXcjBJNNoA/zOf8Aguz/AME/f24vjL/wU4+JHxB+FHwl8V+ItCv7uNrbUNP0u4uLeYCJASkkaFSARiv6q/8Ag2o+B/xk+Af7BH/CFfG7wvqfhLVhqc0n2PVbd7WbYWbDbJADg1/Q6HcDAJFIWLcsc0Af5jn/AAWx/wCCfH7cvxc/4KKeOfHXww+EfizX9GvJVMF9YaXcTwSDLHKSIhU1/XV/wbdfBb4u/Ab/AIJzweBPjX4a1LwprS63dSmx1S3e2n8tkj2v5cgB2nsa/foO4GASKQkscnmgD8nf+C3/AMNfiD8Xf+CY3xL+H3ws0W88Ra7fwWgttP0+Fp7iYrcxswSNAWbCgk47Cv8APn/4J7f8E2P+CgHgb9tT4b+LfGHwY8Y6ZplhrEMtzdXOkXUcUSAHLO7IAAPU1/q9AkHIpxkc8En86AOG8aeA/DHxN+H9/wDDrxxaJfaTq1o1rd28q7leORcMCDX+dJ/wVH/4Nqf2mfgD8QdT+JX7IOmT+NvBd5K9xDZWgL6habjnyxEmWkAPRgBxxjiv9JGjsR60Af5BWlaR/wAFevBGgn4T6Vp/xB0+wVTCdOW3u1UDoV2bc19k/sHf8G9n7en7YvxCstX+MHh++8B+F3nEuoahrkUkNy8eQW8uGXYzlvXdX+oq/h7w9LN9olsLdpOu5okLfnjNaygKoRBhRwAOgoA+e/2bP2bvh1+yd8AtF+Afwntfs+kaBYi2iGBvlZU2mRyPvOxHJxzX+Wf+15/wTM/4KGeKf2m/HHiLw58FPGd5Y3mr3UtvPDpF08ciNISrKyoQQR0Nf62tPEjjgE/nQB+Z3/BJz4Z+K/A3/BOn4f8Aw1+KWjXOkajFprW97p9/E0UyB+CkkbYK5BIwa/kK/wCCwn/Btf8AHfwt8Vdb/aC/YpsP+El8Na1cSXlxokA/0u0lkYuywxrkyJknAAG3GOc1/oRk55NKDigD/Ik8DWn/AAWV/Zw0lvhl4BsviJ4VswSh0+C2uolBPGNhWvUf2cv+CK//AAU8/br+Jw1XxZ4T1fRo9Sm33uueJIpbcFTy0gMoHmH0GRmv9XS40LQryb7TdWVvLJ/eeJWP5kZrRhiit4hDAojQdFUAAfgKAPz6/wCCaf8AwT4+Gn/BOD9mzT/gZ4BY3d22LjVL9hh7q5YfMx/2QchRk4HFfoTRRQAUUUUAFQ3NvFdQPbTgMjgqwPIIPapqKanyvmJlG6sfwcf8FPP2VX/Zg/ap1HTVg8jw7r8v9oWEiDcBDIxDg9twYMdvpX6qfBH4CfC7Vv2Obq1/ZQ8IWeua74zhWytdS1x1V5CB/pDeWy5jVJAyqM88HNfrV/wUe/Yy0r9sT4FXOhWsar4h0ndc6ZLgBjIBzGT6OBgdhmv5NP2bPjf8Uf2Z/GGq/AXxFrI8EJeTm2v9WljlmuLBEzvEEYJUb8HkJznOa/u7hziOvxXkFH2NW2JwzTlF3fNbaVluuy76H8UcR8PUOGM+rOtT/wBnxKfLJWTje943d7J63fRanyp8fPgV8Q/2a/iZN8OfiJ5EerWKpI32aUTRru5ADLxkenav24+EH/BbDVPA/wCzt4a8OanC1x4j8PXcNvdIwO27sAV3MH/56bdwxg4wKX9ob9nT9lPQv2YZ/FHgyzvvGviTxpPBDoGtXVwsl3c3EwO5liGGVIzjcCuea/Fr47/szfF/9nDVINL+KmmNai6UGCaNg8TkDJUOuVDAHlc5Hev0rC1Mm4sw9KhmsP3kG+XmsnK2kmknt5eXkfnGLp5xwrXq18qnanNK7V5RjfVJy6u1nc/sW8Z/Ab9jj/gqp8GrT4j6asP2+eDal/a7Vu7WXkmOUDnAbnBxkc55rx7wb/wSb1X4M/szeKPgP8MfE0M2p+MplS+1WS3KNFbD+FE3k56Z+bmv5rv2Cf2mPiL8APjrocfhzxK+h6Lf3kUepK5zbvCWG7cp4Bx3GK/bb4o/8F8l8FfG/UfDHhbw3Bq/hKxuPJW5RsXEoXhmRi23BIyOOlfiXEHhjxZl2K/s3Jqzq0I/vFGWyfRa6XW6V7dT9kyLxM4Vx+D/ALSzmkqdZ/u5NLV6K+2tn3Z+nHwC/wCCbnwf+FHwH0n4NeMSPET6ddvem9K+W7SOQWUZLEIccjJrxT43/wDBMbU9b/ad8P8A7TvwR8RLodzo7xebpzxFkkjRvnCuGUKGXjGDXt37NH/BUH9lz9pHw/LqNrq8egX9rG0txZ6g6xsiKMkhzhW/Cviv9pn/AILr/Bb4aaldeFfg1pkvie+gJUXbHZahwcEEHDMPdTX5nkuUcdVsfVw0Izc7SUlL4fe3ve6s+6P0PNsdwPh8FTxcnBR91pxXvXj8O3vabWd9PI9E8cf8EXfgp8Tf2lb348+MdQKaTqMiXE2h2sXlL52wbz5u4gqzjJGzvWB+27+3n8Fv2CfCOnfs/wD7PtvZwa27xJLDahdllbgje8hX+PA4U8nmvkHWv+Cxvi/42/sg+Pb6K+tvBfjjTjD/AGatpnM0EjosgTeWJbDN+FfzXeIvEOteK9bufEfiC7mvr26dpJZpmLOzMckk/X04r9v4B8JM0zGq6nFVZyjR92MPs6Lfomkmrea12PxrjvxVy3LKCp8LUVB1rSlO1pava2rT0t5X8z9Lv+Cnv7fMv7Z3xAsNK8KBo/C/h9CtoHBV5pWAEkrD0OBgY49TXQfsFfBGz+Hy3P7Rv7QGgTweEhbMthqM9k91bxzMCBK8QK7kzwrbgNwxXC/sVfsIal8bdXPiHx4s1pZG0a60yzBWKXU5FG4LBJL8hC8buuc1+oXjb9rbwT4I+F3iDwn8W/DFhb61pdtHpETXMNy+lanbwMJBDEsTqolQn5mBxuGelfZcQZrQp0I8N8Pw5oRaUrPWz10/G7SPk+H8nr1MTU4lz+fLOV5RunbTTXtpayZ+d37f3w0/Zp8NfDzQvHPwsIh8Qa1dtNIouVkNxbSqztO1uFBt8vjahLYBxk4r9WP+CDv7JjeGvCOo/tN+LrMx3mqlrTSy3DCAcStgjox2lTmvxh/ZE/Zh8V/t5ftKJbaJpq6T4bjuPtF55W9oLS2DZ8pS7MeeFAyTzmv7p/Afgfw18NvB+neBvCFstppumQJbwRIMBUQYAr8m8duMv7NyqHDFGq5zbvNt6pPVRfn3P1PwT4P+v5rPiWvSUIpcsFa1+8l6o6+koor+N7vqf1slY//V/tAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAPnL9rP9mPwB+2N8AfEH7OnxQ8z+w/EkSw3Pkkq+1XDjBBB6qK/JL4G/8G2X/BMj4MeJ7fxfP4Yn1+9tGEkP264laJWByMxbijfiK/fqigDF8O+HNB8JaJa+GvDFpFYafZRiKC3gQJHGi9AqrwBW1RRQAUUUUAFFFFABRRRQAUUVWvIZbi0lt4H8p5EZVfGdpIIDfgeaALWGpK/mLvfD/wC26n/BVKT9k3/heV6vh/8AsOXxLu+xAkKmx/s2PN6YbGc9ulfTFl/wWZeP4iwQTeB5X+HLeJ18Gr4l88+c+o5RAxt9uBGzOPm3+tAH7uUYNfh1pf8AwWWsNY+DOjfFuw8HAtrHjGXwlHbG4Iw8cjIJt23POM4x3618yfBD/gqB+0V8L/ib+0142/aQ0BJPAvw1vLd1kW6LPZhlKxxRx7PmE2Q5ORtx0NAH9MFFfz1fC/8A4Ly+GfG/gTx1rWoeDln1jwjpFvrNva6PcvewXEFwJCFeYxr5bx7P3gCnbkda+3/2Wf27L39rb9nvxf8AEKztNP06/wBGtbgodMvPtsG4Rb1IkKoQ4J5GOCKAP02or+YL4W/8FotY+Bv7Jnw8k+JKW/iXxz4tutbm36ldNaQC0sbyeNSZQsh34jCquOTivZtY/wCC8vhm50bwNrPg3wlCtv4rtJbia41i7axt45YHRHt7eTy286TL/KCFzigD+heivhn9p79sz/hnD4TeEfjTc6E2o6Dr2q6fYahMrlTYQ37hPtBAB3JGMs3IGBXxh4q/4LBWMfgjxN8SPAnhqzutD0zXzomlahqF6bW2v9sMczTbwj7UG8qCAeVoA/bXBor+Z1f+CuWtfHbx58BPiN4IlbQdC1fXtTsvElhE5milXT4bgtskwN6sYtykgZ44ruPhF/wcC/Dr4oeLpdJXw5bjTr6xv73SJbW7aaeQWWMJdx7ALcy7vlwWzg+lAH9FVFfiVf8A/BYzSbP4d/CTx7/wiW4fFLQtZ1pYRcHNqNJieQx52/N5mzGe2a8th/4LU/EpP2aoP2ntZ+EcuneH9Vuvsml3FzdOkEjCXymknkEZ8qIYPzYPSgD+geivhj4J/tmW/wAV/wBk69/aYk0qOY2EVxJJaaVN9sjkMBIxDJtUuG7HaK/PX4cf8FxPC/iL4HeLvjP4x8N2lqvh61Se3sdPvTdXDyylgkFyrRoYZcrgjnFAH740V/P54l/4Lca78NPA3jST4tfDZtL8YeE7fR9Qj0mG6aWO6stZuktoJFl2KQ4LEldvbGa8s/aD/wCCuH7Q+t/A/wCKHgvw34B/4RTx/wCFNNsdXi/0tnQadeNAyTh/LHz/AL1UKY455oA/pWowetflt8Kf20fHnw8/4JpQftfftK6GLK/0fREvpraCYzNdphBHJuIGGlLAkYOK/LPTP+Cunxx0T9q+b4gfHfw/L4T8GWfgWTxCmixTG4FxiORonDFVw77RlccetAH9StFfz8Xv/Bb/AF3wH4d16b4y/DSTQ9atfD9r4n0iyiuWmW/066mEUbFyi7H5ztAP1rf8Of8ABaDX7eHxZp/xX+HD+H9X0XwdD41062W5aRb7T5XgTBYxrskBuF4welAH70UuCBk1+Bvgb/gt3BbC6u/j/wCApfB9nN4Nk8a6XKk5nN1YxKhZWDKm1x5i8ZPevmT9mP8A4LT/AA50q9+KHxS+K8tzdXJ01Nesba2v5L2xS3csI7ZFZFWCXKZcDPBFAH9RlFfz4/C//gu/4Z8eeA/Hes3PhGO41jwZpFvraWmk3L3kM9rcyxxKWm8tNjoZQZFAO0A88V99fsPft6Wf7W3wc1/4satYWGmp4eXzZ1068N7CU8p5f9YUTDALhgRwaAP0Uor+dr4Of8HAXw2+LPxAj0C38PQLpOrW2oXGkT29001y32EKdt3DsAg8zd8vzNnB9K9N/Zl/4LKa58aviD8NdF8f/DmXwx4d+Kv2xNB1X7Q0wllsywdWQooAIXg5NAH7sUV+IP7Xv/BXPxl+zZ8bvGXwp8J/DZvE9r4EsbfUtUvRctGVt5mjTKIEbLq0g4zyO9eeXX/BcG48O+BfiB4k8b/DmXTL7wp4etvE2mWpuGIv7C6G5C7FB5b4K5Xnr1oA/oBowetfzk63/wAFz/il4Wn8T2viT4MzW8ng7T7XXNVAu3Ii0m73lJwfL5fEb/J7dea8z8af8FfPFXwy/bD+JGiatY6/rvhe78FW2p6Da6NZG7Nlc3CbxJPhhsQBgCfWgD+oKiv5jf2Xf+CwvxeX9n74baIPDEnj3x540TWtUkWaU2gg0/T7lky5Csd6jAC/rX7R/sEftcp+25+zvZfHhNFfQPtV1cWpsncuyGAgEliAec+lAH2fRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFVUvbOS5aySVTKgyyZ+YD6Vcacmm0tiJVIxaUnuWqKMjrXjPjT9oP4PfD7U/7H8W69a2lyOsbyDcPqK9LKsjxmOn7PB0pTa1tFN/keZm2e4PAU/a4yrGC7yaX5ns3tX4e/8ABUj/AIJeab+0lpVx8Y/g9bpbeL7SPdNCowt4qjp/vgDg1+wWh/FP4f8AiW1t7zQ9Vt7lLo4i2ODuPoK9AxXv8P55mvDePjiqV4TXRpq+uqa7Hh51lGV8R4GWGqtVIS6pp2ut0+/ofwjfs5ftVeKv2bfiRZeEvjlppkk8MJLa6Yl2mBps0zDdMExhsbeDjjtX6feJvGXww/ak0nWdQu9FhvPB+l6pNaaCi3Eksur6tqUUcQYhzvjSJtrYXAr9WP22P+CaHwQ/bC06bVru3TRvEwQiLUrdQGYgfKJQMbx9a/mE+J/7K37aH/BPHx/b+J7aylvdN0iX7Ta6jGhuLIO5wGI6LLgD3Ff1tkHEeQ8Tf7Rh5qhi7bN2Tf8Ade2u2nd9T+Xc44czzhy2GxEfb4S7s0tVd/aXW2lumnyO/wD2nv8Aglhq3gnxjDH8HL8ajpj6GmsXbzYEcM7TGA2sbLkM3mDaMnOa/OX4s/s0/G/4FWllqfxQ0GbSrfUVDQO5VlPGcEqx2sB2OD14r7+8O/8ABSG81n4JeFv2ffHFtLp32LWvtWpatDlpZIDcG7X5OD8kxDbc8gdq9D/bd/aP/Zz+INz4UtdT1W48V2ryyXWr29hKYIH5KxPhdwSbYRvHPOea/UeHc14mwuIp4PHQ9pF82qV20r2d72V/PyPzLiDK+HMZQqYzAT9nL3dLpK7Wqaavptp1ufjR4f03xHeySN4at7idgpWQW6MzbW6g7QTg96uaF4I8Y+J9Sl0nQNJu7y6g5kiiidnTP94AZH41+2v7CHxA/Zy8JXvxP8V+BkudH0Oz0RJ1NwBcXKSIGMnlhiC3tXdeFv2ovhL8cNB8c2f7P+raf8LvGN7d280OqXzLZte2qFcgydVfIYlRnr716mYeIGYwr1YUcG1CDiuZp6NpP3kr7XtpsebgOAsurYejKpi05y5nyq2tm17rdkr266PofjDov7MPxy174f638UrDw7dvpHhyRYdQfYVkhZgCN0Z+fGCD06c1+z37L37C3wu+D03gvxR8SWt9V1Hx7pEd/oVzeZ+y2t+yq628kYyr70Lkbgfu11Xjf/got8JvhH8Z/Efh9NQTXLPVfDtra6lf6eqzwXmqRJGGbAwGVkUxMx9Se1fB37QH/BQHx5+0TbW3gX4XeHn0a1hfTZNMhsyXks57OAw7YSANqtuOMYr5DMq/EucxVKvH2NFptyva6aur37Pfv1R9XleD4dyV89Cftq0dErX1Td2raara97PVOx9SfGT9vL4deFfiD4q+EP2S402x0Njc6LdWqBXs9Xhz5nlA4xBKQoMfC4HSvkTQtL/ai/4KqfGHT9Ft4NunaftjZoYlitLWP+KRgoVTI3JJ5Jzg19Tfsp/8Eff2gv2lvEv/AAtX9pmafRNPvJjLcfasm+uWPJYqcEBv72TX9TfwF/Z2+FP7N3gmHwL8KNLi060jAMjKB5krgY3uwHzH3NfmfGHinknDtN4bIUqmIty8+6i7K7T63fyP0bhTw1zriCSxGeN08Pfm5NpS7Jrol062OD/ZC/ZM+Hn7IvwstPAHgmFWuNoa8u8fPPLjkk9cZzgV9W0hpa/jbH46ria0q9eTlKTbbfmf1vgcFSw1KNCirRikkkFFFFch1n//1v7QKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD5Tk/Y9+Fsv7W//DZkk16fFX9jvonk+Yv2Q2zhQTs27t+FHO78K+T4v+CP37NsXxeHxOGsa/8A2Wmt/wDCRp4Z+0xf2Oup5Ui4EPleZuBRSP3mMjpX6uYz1ooA/Gt/+CIv7MZ8fReMLfxL4pg06210eI7bQo7uEabDqG7cZUj8neN3Rsuepr2D4g/8EqP2dviP8RvHPj3V9S1u3tPiPax23iDRbe4jXTbxogBHM8RjLeYuODu9eK/TSigD8xfht/wS3+F/w2+H2u+ArXxp4nv/AO2raKzS/upbU3dnBCGCLbulsqjG7+NWzgZruv2YP+CdHwe/Zb0jxjZ+G9W1jW77x1vGq3+pzRvM4dQvyCKOONcAcfJX6AUUAfkpqf8AwRv/AGapPh94T8EeGdZ1/RLrwbNeyadq1rNB9uCX8rzTxO0kLoYy0jYGzI45q78Wv+CRXwV+L3gbS/hzrHi/xPZaTYWv2S4htJ7WP7ahKlmnJtid5KjJTZX6ve1FAHzb45/ZU+E3xB/Zmuv2T9fglPhW50s6SNrDz4oihQSI5BxKucqxBwa+LtS/4I6fsxv8CfAHwG8K6nrug2fw5uJbjTNQsriIXsjzgrJ57PE6SblJHKdK/WOjJHSgD8kfhh/wRl/ZV+FkfhWLTdQ1zUP+ET1S91a3N5PE3nz6gsqziYLEoZCJmwAFrp/gh/wSb/Z++BesXD6FrOtanojwXNtbaHfvbPY2kd199YVWBZB04y5r9R6KAPxW8If8EMf2Y/CutaVqcni3xdqVpoFpqVhpNhdXsLWtla6pGY5ooVEIIVQxKZY4J719V33/AATw+GC/svaF+yn4W8Ra9oejeHXke0vrOaH7b+8dnYO0kLxkEsR9zpX39RQB8U/s6fsJfCX9mP4Cal8APh9fanJYatLcT3V9czK9481yxd5AwQICGJIwmB6V8p6N/wAEVf2XkHiqfx1rPiDxVd+K7AadNc6lcQmS3hXdtMAhhiUOu7hmBPSv2CoyaAPyDs/+CMH7Ns/g3xH4Y8aeI/E3iW+8Ttpq3er6ldQyXywaTcJc2tvHIsKqsSug42k4zzXvGt/8E1v2ePEnjvxZ4+119Rubjxl4dg8M38Lyr5ItLYR+WyDZkSAxKckkZ7V+glFAHwz4N/YG+F/hv9kvU/2NPEmt634q8J6nbSWbPrE8c1zHbuQVijdI0AWPACZBIx1NfKngb/giN+zB4X1G+1TxZ4j8UeMJL7RJPD2Nau4plisJFZBHGEhTHlhjsJzg+tfsjRQB+POk/wDBFT9miLw/ruieMfEfifxNNremwaOl7qd3DJcWWn20omjt7VlhUIgYYwwY4716v48/4JV/s5fEPxJJ4o1y+1hbiXwangdhHPGF/s6OSCQPgx/67dbplumM8V+l9FAH5neIP+CUf7L/AIsvdCufEzanfQ6B4Rm8FxW8syGKXTpxGGMo2ZMv7pcMCB14rn/AX/BI79nzwj8PPEHwv8Sa3rnirSNesP7NWPVZLZzZ24LFBbtFBGQU3cFt3av1RooA/Mn4df8ABLv4Y/DnwFr3gez8aeJr5tctYrJb+5ltDdWkEBUxx27pbKoA2AfOrZr0L9kf/gnp8Hf2QNL8YWvhTUtV8QXfjpw+r3msSxyyy7Y3jCgRRxoBtc5wtfenXrRQB+Uvwl/4JDfs/fBzUL2Pwzr+vyaHNBdW9ros0tsbOyS7AEn2cCASDGBt3Oce9dt4S/4Jb/s7+DdH+EWh6Veau0PwWmu59CMk8ZMjXufM+0/u/nAz8u3biv0kooA/P74p/wDBN74D/F7x147+IPie71WO9+Iemw6XqawTIsawwvG6mIFCVbMYyST34ry74h/8Eg/2YfiXYaxYa/f62i634ZtvCs5iuIwRZWoVUZMxnEmFGWOR7V+qVFAH5p+NP+CV/wCzp46vfHN/rF7rCv8AEDw3aeF9REc8YCWdmJRG0IMZ2yHzmyTkdOBXX/DX/gnD8Avhd498RfEXQptRuL7xN4ch8MXS3MkbxrZwJsVoxsysuOrZI9q+/aKAP5v/ANrX/gkj4t8HeG/AOh/sf6Lfa7D4Vj1OEzDVrfTdTUalIZXUXMyGNodxyYwm4joa/TD/AIJbfspeM/2M/wBjzQfgn8QpY31mCWa8uliYOsck+CY944bbj7w4NfohRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFACHpX4ofte/GD4k/s8/tMjx14Xu/NtLqJQ1sWyhUdVZex4r9sK/HL/gpp8B0u7e3+MGn3LIyYjmh+YgnqGGOBxxzX9CfRrxGX/6w/U8zSdOtFws1dNvZeXqfzh9KChmUeG3jsqbVSjJTunZpLdr5PY9i8Ef8FJ/hF4r8PMniAS6VqXlMGDAmMNt7NwK/B/4oeLbnxh461HxNfyPfNPOxWQMSdpJx+AriR5bDEX3T2P600gqB5Q56AAV/pF4f+D+T8N161bLIte0to3e3knuvQ/y/8TfGrOuKcNRoZpKL9ls0t33a1TfmfpB/wTn8I6/42+K0kv8AaEtta6WgmEeSc5PQZ4Ge/Ff0RgYGK/n/APgD8QLT9ij9l3W/2mfFWnyX19q1zbaVpFiv37q5u5Vit1GcHaZXAY9h3rw29/4KS/td6d42bSJvH3gU+JxKyDwoLTVGjMqoZGs1vAnkm4CKQcSkBge3T/NT6SXEsMx4qr+xknCn7qt5b/jc/wBSfov8LVMr4Qw6rpqdT33ffV6ell0P6cqztT0nTNbtH07V7aO6gkGGSVQ6kHrkGv5jf+Cg3/BYv42+F/2Yvhj4y+BEMPg2+8eak+la1rV9G81voVxAwSZZNgccMeMg9K9N/ZJ/aQ/4KI6PpHjeX4o+OPDPxY8I2vhq61XTvFei3EPnW11HC8iQy24YMMkAZMf41+DQk4yUo6NH9CSimrS2/rufob8c/wDgk9+xt8dLmTU9S8P/ANiXsuS8+mERO7Hu24MPyFfl143/AODeK0utVkuPh948W0tM/JFe27SuB2BZSoP5V5R/wTM/4L7TeP8A9mn4p6x+15fRp4w8Bi5u9PZx5f8AaNsZDBbrGuBvczkR4UdBXzl8GP8AgtF+2l8Uv+Cbvxh/ajv9SFj4g0DxNBZ6WhiXNpazMSYSCvJUcc81+jZF4ucRZdHkw2Kkl2b5l9zufn+d+FfD+YSdTE4WLl3Wj/Cx7jqn/BAT9ofSpHh0HxdZXELjaxVWiDD0IL8j2NbXhz/g3s+MF6BNr3jew05vRYHkP5q9fVn/AAUl/b8/aK/Z3/4Ji/DD9pP4Z6otp4p8TX+iQXtwUU7470nzgFIIGfpXy3+0d+2r+3r44/4KM6X+yZ8E/irpHw50m48L22rPdawIlgMzRl2BZ1PLYx1/CvqpfSK4pceVVkvPlX/DHzS8AeGObmlQb8nKVvzPqb4Sf8G/fwi0CY3Pxh8UXWtsDuC2Q8hfo28Px+VfrV8C/wBiT9mf9ne1ji+G3he0guUABupEDzPjoSx4z9AK/m48Ef8ABYH9sF/2MP2krbxVqWnal44+C5hXT/E+kjzLW7ElxDGTyChfEh4AxjtXzHd/8FYf2/Pgz8HPhd+0W/xp8PfEi78ZXunQ3fguBFN7EL1dzhvKRWHl9Dz1r4HP/ETO80usdiZSXa9l9ysvwPt8h4AyfLLfUcPGL72Tf3vX8T+5BVCgKoAAGABxTq/ld/ap/wCCzHxi/ZV/4K7+DvgL45fyvhfruhadLqFuyD/Q7m+BBndwMhUI5ycVa8d/8FovH/xG/wCCxngv9kH9nu/jl+HYL2uqXSKHjvbnyjKPLkwRhVKng9a+MZ9gl2P6mKK/jU8D/tuf8FNv2i/jN8eYvh/8bPD3gnSPhXrV9bWun60IYzcw25kdUjJXJ+VNvXrXN/FX/gvD+17ff8EvPh/+1n4KtYtM8VXHil9E1JIY/Mivo7ZyjsgIJ/eAEnHTtSA/tPor+Sf/AIKZ/wDBwUfAP7Evw/8AHv7IV6h8b+OYYrucACR9Mij2+aJlIIUucgBh2r+jT4R/FHxP4q+FPhjxRrEivd6lpNldTt0zJNAjufxYmgD/1/7QKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAD0r43/aa+L2heGtDu/DPijwpea7bTKcBI9yE+ueor7IqCW2gn4nRXH+0Af519HwtnNHAYuOJr0vaJdLuPzutT5rirJK+YYSWFoVfZuXXlUvwlofyPeKfCOteI/FVzceEvDl1p9vNITFb7XcKM9Ax5r7E/Zq/YJ8e/EHW7bWvHlu+m6TGwd964aQZ+6AfUV/Qkmj6Sp3Lawg+oRf8K0EjSIYjAUeg4r+luKfpdZvjMC8Fl9FUbq17tu1u76n8tcKfQ0yXBY9Y/MK0q2t7WUY3v2R+SX/BVH4P6/F+yp4f1b4XaU+oJ8P9f0rV5rCBcvJaWl1FJcMqgclI0ZvrX87XieDUJfBsN/8ADLxx4GXRND8UXfjLSbzUHuF1aa51BpWexuohbkr5ZnKghicqK/uRkjjmQxyqGUjBBGQQexrw1P2Yv2eI/E3/AAmUfg3Shqm/zPtIt137uuewzX8lVarnJyk7t639T+xqVKNOKhBWS0t5I/nn8V/Bn9r/AOFH7EHgmb4ZfDzSPjHpGu6pea/4p8OXNusryHUXEuLXzUyAnIB4PTivjD9k/wDYQ/ao8SftV+Mfjz8L/hHqfwP8BXHhDUtPuPDlxO7DU9QuIJFjMcO4oPmIAHbqK/tZjjjgQRQqEVRgBRgAegA4p+ewrM0P5IP2Ef8Agg9oHxX/AGfvhv4r/ay0e/8AB/i3wVrN5c3GnOgDX1qLya4ghuAGxs3lZBnOa4n4Qf8ABKv9pnxf+xb+1T8EtV8NTeF9W8UeM7nVvC8V2qpFdwpPI0RQLnCMuMcenFf2LZPWjJ6UAfxT/Ev4e/8ABTn9vn4IfCn/AIJ//EH4IX3gjSfB2o6dJq/iO7b/AEd005uJEwT98ZOMV9L/ABx/4JI+I/2ov+Cr/wDa3xo8KalL8No/B66dHrlvIYYUvI42RMOjBiQdpx3r+sDpRk0Afxi/DP8AYG/a1+D3/BNb9pr9gWz+F13NfzXQm8L6xbRRhtatmu4pApkyGeVFznd2Q818dX37A/7U3xb/AGefhh+z/wDDn9la/wDh1498O3WmvfeN7hEt8G1ULNIzxMWO88n1r/QAz2o3NQB/K58WP+CXvxU/aL/4Kl3Mvxu0C7vfh9qXw0j0K68R7AYl1AQumUJOfMVjkHHWsGH/AIJCeKf2TP20/wBnWw/Z70C/8QeFPCn2yXX/ABA6rkzSJIqPcEtnOCqDr0r+sAcDA7Ue1AH8jX7Df/BFfQfi3+0/+0B46/bk8B6ta6fqviqe50CR7qS1hvLSV3feFibDqSR96vq3/grB/wAE9dcvvgd8Hvgr+xz4Ce50Lwv4os7m5stORcQ2wLCWaT7ueMFm6mv6OcmkzQB/I1+3v/wQa8OfDv8AZZ+K3jH9lPRL7xV418cXOmvZaNGik6fDG5aaK2y3C8ndjFf0YfBbwD4q8P8Awc8J6DrVm1veWOjWFvPE2NySxW6K6n3DAg19a9fxpctQB//Q/tAoqkdRsQcG4j/76H+NH9paf3uI/wDvof41x/2hQ/nX3r/M5/rdPuvvRdoql/aWnf8APxH/AN9j/Gj+0tO/5+I/++x/jT+v0P5196D63T7r70XaKpf2lp3/AD8R/wDfY/xo/tLTv+fiP/vsf40fX6H86+9B9bp9196LtFUv7S07/n4j/wC+x/jR/aWnf8/Ef/fY/wAaPr9D+dfeg+t0+6+9F2iqX9pad/z8R/8AfY/xo/tLTv8An4j/AO+x/jR9fofzr70H1un3X3ou0VS/tLTv+fiP/vsf40f2lp3/AD8R/wDfY/xo+v0P5196D63T7r70XaKpf2lp3/PxH/32P8aP7S07/n4j/wC+x/jR9fofzr70H1un3X3ou0VS/tLTv+fiP/vsf40f2lp3/PxH/wB9j/Gj6/Q/nX3oPrdPuvvRdoql/aWnf8/Ef/fY/wAaP7S07/n4j/77H+NH1+h/OvvQfW6fdfei7RVL+0tO/wCfiP8A77H+NH9pad/z8R/99j/Gj6/Q/nX3oPrdPuvvRdoql/aWnf8APxH/AN9j/Gj+0tO/5+I/++x/jR9fofzr70H1un3X3ou0VS/tLTv+fiP/AL7H+NH9pad/z8R/99j/ABo+v0P5196D63T7r70XaKpf2lp3/PxH/wB9j/Gj+0tO/wCfiP8A77H+NH1+h/OvvQfW6fdfei7RVL+0tO/5+I/++x/jR/aWnf8APxH/AN9j/Gj6/Q/nX3oPrdPuvvRdoql/aWnf8/Ef/fY/xo/tLTv+fiP/AL7H+NH1+h/OvvQfW6fdfei7RVL+0tO/5+I/++x/jR/aWnf8/Ef/AH2P8aPr9D+dfeg+t0+6+9F2iqX9pad/z8R/99j/ABo/tLTv+fiP/vsf40fX6H86+9B9bp9196LtFUv7S07/AJ+I/wDvsf40f2lp3/PxH/32P8aPr9D+dfeg+t0+6+9F2iqX9pad/wA/Ef8A32P8aP7S07/n4j/77H+NH1+h/OvvQfW6fdfei7RVL+0tO/5+I/8Avsf40f2lp3/PxH/32P8AGj6/Q/nX3oPrdPuvvRdoql/aWnf8/Ef/AH2P8aP7S07/AJ+I/wDvsf40fX6H86+9B9bp9196LtFUv7S07/n4j/77H+NH9pad/wA/Ef8A32P8aPr9D+dfeg+t0+6+9F2iqX9pad/z8R/99j/Gj+0tO/5+I/8Avsf40fX6H86+9B9bp9196LtFUv7S07/n4j/77H+NH9pad/z8R/8AfY/xo+v0P5196D63T7r70XaKpf2lp3/PxH/32P8AGj+0tO/5+I/++x/jR9fofzr70H1un3X3ou0VS/tLTv8An4j/AO+x/jR/aWnf8/Ef/fY/xo+v0P5196D63T7r70XaKpf2lp3/AD8R/wDfY/xo/tLTv+fiP/vsf40fX6H86+9B9bp9196LtFUv7S07/n4j/wC+x/jR/aWnf8/Ef/fY/wAaPr9D+dfeg+t0+6+9F2iqX9pad/z8R/8AfY/xo/tLTv8An4j/AO+x/jR9fofzr70H1un3X3ou0VS/tLTv+fiP/vsf40f2lp3/AD8R/wDfY/xo+v0P5196D63T7r70XaKpf2lp3/PxH/32P8aP7S07/n4j/wC+x/jR9fofzr70H1un3X3ou0VS/tLTv+fiP/vsf40f2lp3/PxH/wB9j/Gj6/Q/nX3oPrdPuvvRdoql/aWnf8/Ef/fY/wAaP7S07/n4j/77H+NH1+h/OvvQfW6fdfei7RVL+0tO/wCfiP8A77H+NH9pad/z8R/99j/Gj6/Q/nX3oPrdPuvvRdoql/aWnf8APxH/AN9j/Gj+0tO/5+I/++x/jR9fofzr70H1un3X3ou0VS/tLTv+fiP/AL7H+NH9pad/z8R/99j/ABo+v0P5196D63T7r70XaKpf2lp3/PxH/wB9j/Gj+0tO/wCfiP8A77H+NH1+h/OvvQfW6fdfei7RVL+0tO/5+I/++x/jSjUbBuFnjJ/3h/jR9fofzr70H1ul/MvvLlFRpLHJ9xg30NProp1IyV4s1VRNXQtFLg0lWaNNBRRRQIKKKKACiiimkS5dAopM9qie4t4v9a6r9SBWdWrGHxu3roKVSK3ZNRVI6npo4NxH/wB9j/Gj+0tO/wCfiP8A77H+Nc39oYf+dfejFYyltzL70XaKpf2lp3/PxH/32P8AGj+0tO/5+I/++x/jT+v0P5196H9bp9196LtFUv7S07/n4j/77H+NH9pad/z8R/8AfY/xo+v0P5196D63T7r70XaKpf2lp3/PxH/32P8AGj+0tO/5+I/++1/xo+v0P5196D63T/mX3ou0VVW+spP9XNGfowNWFdWG5SCPUVtTxFObtCSfo7mlOtGXwu46iiitmjRMKKKKQBRRRQB//9H9lH8TeIZDue9mJ/3zTf8AhI9e/wCfyb/vs/41i0V/j48yxD/5eP72f54fW6v8z+82v+Ej1/8A5/Jv++z/AI0f8JHr/wDz+Tf99n/GsWil/aOI/wCfj+9h9bq/zP7za/4SPX/+fyb/AL7P+NH/AAkev/8AP5N/32f8axaKP7RxH/Px/ew+t1f5n95tf8JHr/8Az+Tf99n/ABo/4SPX/wDn8m/77P8AjWLRR/aOI/5+P72H1ur/ADP7za/4SPX/APn8m/77P+NH/CR6/wD8/k3/AH2f8axaKP7RxH/Px/ew+t1f5n95tf8ACR6//wA/k3/fZ/xo/wCEj1//AJ/Jv++z/jWLRR/aOI/5+P72H1ur/M/vNr/hI9f/AOfyb/vs/wCNH/CR6/8A8/k3/fZ/xrFoo/tHEf8APx/ew+t1f5n95tf8JHr/APz+Tf8AfZ/xo/4SPX/+fyb/AL7P+NYtFH9o4j/n4/vYfW6v8z+82v8AhI9f/wCfyb/vs/40f8JHr/8Az+Tf99n/ABrFoo/tHEf8/H97D63V/mf3m1/wkev/APP5N/32f8aP+Ej1/wD5/Jv++z/jWLRR/aOI/wCfj+9h9bq/zP7za/4SPX/+fyb/AL7P+NH/AAkev/8AP5N/32f8axaKP7RxH/Px/ew+t1f5n95tf8JHr/8Az+Tf99n/ABo/4SPX/wDn8m/77P8AjWLRR/aOI/5+P72H1ur/ADP7za/4SPX/APn8m/77P+NH/CR6/wD8/k3/AH2f8axaKP7RxH/Px/ew+t1f5n95tf8ACR6//wA/k3/fZ/xo/wCEj1//AJ/Jv++z/jWLRR/aOI/5+P72H1ur/M/vNr/hI9f/AOfyb/vs/wCNH/CR6/8A8/k3/fZ/xrFoo/tHEf8APx/ew+t1f5n95tf8JHr/APz+Tf8AfZ/xo/4SPX/+fyb/AL7P+NYtFH9o4j/n4/vYfW6v8z+82v8AhI9f/wCfyb/vs/40f8JHr/8Az+Tf99n/ABrFoo/tHEf8/H97D63V/mf3m1/wkev/APP5N/32f8aP+Ej1/wD5/Jv++z/jWLRR/aOI/wCfj+9h9bq/zP7za/4SPX/+fyb/AL7P+NH/AAkev/8AP5N/32f8axaKP7RxH/Px/ew+t1f5n95tf8JHr/8Az+Tf99n/ABo/4SPX/wDn8m/77P8AjWLRR/aOI/5+P72H1ur/ADP7za/4SPX/APn8m/77P+NH/CR6/wD8/k3/AH2f8axaKP7RxH/Px/ew+t1f5n95tf8ACR6//wA/k3/fZ/xo/wCEj1//AJ/Jv++z/jWLRR/aOI/5+P72H1ur/M/vNr/hI9f/AOfyb/vs/wCNH/CR6/8A8/k3/fZ/xrFoo/tHEf8APx/ew+t1f5n95tf8JHr/APz+Tf8AfZ/xo/4SPX/+fyb/AL7P+NYtFH9o4j/n4/vYfW6v8z+82v8AhI9f/wCfyb/vs/40f8JHr/8Az+Tf99n/ABrFoo/tHEf8/H97D63V/mf3m1/wkev/APP5N/32f8aP+Ej1/wD5/Jv++z/jWLRR/aOI/wCfj+9h9bq/zP7za/4SPX/+fyb/AL7P+NH/AAkev/8AP5N/32f8axaKP7RxH/Px/ew+t1f5n95tf8JHr/8Az+Tf99n/ABo/4SPX/wDn8m/77P8AjWLRR/aOI/5+P72H1ur/ADP7za/4SPX/APn8m/77P+NH/CR6/wD8/k3/AH2f8axaKP7RxH/Px/ew+t1f5n95tf8ACR6//wA/k3/fZ/xo/wCEj1//AJ/Jv++z/jWLRR/aOI/5+P72H1ur/M/vNr/hI9f/AOfyb/vs/wCNH/CR6/8A8/k3/fZ/xrFoo/tHEf8APx/ew+t1f5n95tf8JHr/APz+Tf8AfZ/xo/4SPX/+fyb/AL7P+NYtFH9o4j/n4/vYfW6v8z+82v8AhI9f/wCfyb/vs/40f8JHr/8Az+Tf99n/ABrFoo/tHEf8/H97D63V/mf3m1/wkev/APP5N/32f8aP+Ej1/wD5/Jv++z/jWLRR/aOI/wCfj+9h9bq/zP7za/4SPX/+fyb/AL7P+NH/AAkev/8AP5N/32f8axaKP7RxH/Px/ew+t1f5n95tf8JHr/8Az+Tf99n/ABo/4SPX/wDn8m/77P8AjWLRR/aOI/5+P72H1ur/ADP7za/4SPX/APn8m/77P+NH/CR6/wD8/k3/AH2f8axaKP7RxH/Px/ew+t1f5n95tf8ACR6//wA/k3/fZ/xqRPFHiOPmO+nH/Az/AI1g0U1mWIX2397GsZVX2n952Nr8RPHdmQbfVrpMekrD+VehaJ+0T8UNFIAvRcKO0o3E/iTXhlFergeLs0w0uehiJxf+JnbhM/x1B81GrJPybPuXwv8AteKzLB4qsNo6GSI5/HbxX1V4S+JHhDxtAJtBu0djyYycOPqK/GzAK5PNael6vqWjXaXulzPbyocqVOK/a+EfpH5zg5qOYP20PPSS/wC3tr+p+k8O+MuYYaSjjP3kfPc/bnocGkznpXwl8K/2opUeLRfHi7xwq3I6j/e9frX3Bp+o2WrWaX2nSLLFIAVZTkHNf2VwT4hZbn1D22Cnqt4vSS9T+j+GeMMHmtLnwsteq6ovUUZHSivurM+ovfYDnHFeY/ED4teEfh5b/wDE4nDTkZWFDlj+Fcb8cPjLbfDjTPsGnkSanOuY0/uA/wARr8ydd1vUvEGoyaprUrTTyHJJyfy9q/mfxd8do5TN5fltnV6vpH/gn4n4h+Kv9nyeDwGtTq3sv+CfRfjX9qHxpr0z2/h8LYW2eCvLn33dRXh1z488aXrGS61S5dmPOZGrkVwOBS5FfxZnPGmaZhUdbF15Sb89Pkj+b8x4jx2LqOpiKrb9TcbxJ4gY7mvZs/75/wAaT/hI9f8A+fyb/vs/41iZFAIPSvFeZYi+tR/ezzFi6nSX4m3/AMJHr/8Az+Tf99n/ABo/4SPX/wDn8m/77P8AjWLRkDrR/aOI/wCfj+9j+t1f5n95tf8ACR6//wA/k3/fZ/xo/wCEj1//AJ/Jv++z/jWLkHpRkDrR/aGI/wCfj+9h9bqfzP7za/4SPX/+fyb/AL7P+NH/AAkev/8AP5N/32f8axcg9KTIo/tHEfzv72H1ur/M/vOgi8VeJbf/AFN/OpHcOa6zQfjH8RfDlys1pqU0gBzslYuv5GvNKbk5IrswvEGNozUqNaUWtrNmlDNcRRkp0ptPybP0B+Hv7Vmnaiyaf42h+zyHAEy/dJ9T0xX15YajZaraJfadKs0UgyrKcg5r8QMjdh+lfQHwa+Nmq/D3Uksb6RptMkIDoSTs9x9K/pzww+kViYVY4PO3zQein1Xr3R+5cEeMNeNSOHzSXNF6c3VevkfqZQKzdJ1aw1zTodV01xJDMoZWHoRWlX9s0qsKkFUg7p6prZn9KUqinFTi9GFFFFWan//S/Xiiiiv8bz/OcKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooARs44r6O+Bnxtv8AwNqiaHrLmXTp2CncfuE9x6CvnI80HOc19HwvxPisoxkMZg5NST+9dVbzPXyPO6+X4mOKw0rSX4rsz9v7S6tr62jvbRg8cqhlYdCD0rG8WeIrTwn4eutfvjhLaMvjOCSB0Hua+Vv2W/ibLqlq3gjVn3SQDdAx67fT/ParP7XPiaSx8OWfhyNsfbHLtg84jxx+tf6D5p4qUJ8Jzz3Db8trdpvS3yP63x/HNOWQSzShva3/AG9t+DPi/W9R8T/FDxfNfxRSXV5cElY4wWO0dlA7YpLr4ZePLOEz3Gj3gVereS/H6V7z+xUc/H3TZB18i4/9ANfYtp8ZPjJcftEXPgBrf7XoRk2FGgAAUrkkuRzX8lcLcBYPNcDDMMdVqe0rVHG8YqST3u77b6tH4FknCGEx+GjjMVOTlUm46K/Z3evnqfkUytFIY3BDKcEHqDXUL4H8XHSv7dGnT/Y9vmGby22bfXdjGPfNfTP7RvgHSJf2kP8AhFPCEagXrQkxIBgO4BbgetfpDHqHg1HH7OIVSW0sjb0+Tbg/jWnCvhDTxlXFU8TV5fZycIPdSmr6b9bIrIvDmOIrYilWq29nJxi1b3pdPvPwdjVnfavJY8V3Vt8M/H13Yf2pb6TdNDjO4ROcj24r0r4deHND8MfHyDw/4+Cpa2l2yMJB8uc/Jn9K/R/4o67+0L4Z8Wpq/wAOra31PwtGF/0e3RCxTHzAnt7YNcPBnhth8Zg6uJxs5e5LlcYJSku8mm07L0OThrgmliMPUrYiUrxdrRV2t9WrrS99j8YpYJraVoLhSjqcFWGCD7iomGRivZfjv4s07xh49n1ez0ttHlZQs0LLtO8dTj3NaHwc/Z/8afGl538OPDFDbEeZJMSAM/QGvzyHC2IxWZSy7L06krtLS17dddvO58jTySrXxksHgk5u7t/XQ8LAAHFMPyKd3OK+29c+AnwY+HmnXQ8a+JnuNTihfbbQxnb5gBx8xA4ziviu1e2hvopLwFoVdS4HBK55/SnxDwpXyucaOLlFSe9nfl9bbWuTnGRV8BUjDEON32adumtjY0/wt4j1awk1PTrOaW3h5d0QlVx6kDFVNL0TV9bvBY6PbSXEpONkalj+Qr9dfhv418BeLPgX4jsvAGmHTrO0tmU7wN7sVOSSM56dzXiX7Gt9pf8AYfiPT9CjRfEzJIbV5Fz0Bxg44561+px8JsFLGYTD0sRzRqwcrpbtX0jfvbrY++XAGGeIw9GFfmVSLldLqukT4O8QeBvF/hZBJ4h06e0Q9GdCF/MjFVtD8I+JfEkbyeH7Ke8WE4cxIWxn1xnFfqlq1/41sfgRrsn7SKxSTOxS0AQbunGNvH3uevSuD/Y7g17TPg54nv8AwjLHFqkzqLcykbQyggEg9qv/AIhLg3m1PCe0moSpubTSVSPaLSaTbfnsaf8AEPsP/aMMM5S5ZQcmtOdW6W2Pz61H4d+N9LtX1DUtLubeGMZZ3jYKPqcVxh9a/SP44L+1ZbeAZ5/E2pWGqaRKuJ/scakqO+TgY98V+bYIYBRX5zx3w5RyzGKhQjOKav76SevblbTR8XxXktPA4hUqSktPtJK78rN6H2/+yp8S5hdSeAtUkyjDdblj3HVRX3aevFfix4P1u58P+JbPV7Rtjwyqcj0zg/pX7M6ZfRanp0GoQfcmRXH0IzX9k/Ru4wqZhlMsFWd5UnZf4Xt935WP6N8GOI54vASw1V3lTf4Pb7i9RRRX9HH7Kf/T/Xiiiiv8bz/OcKKKKACiiigAooooAKKKKACiiigApCcUtNbHGeKAOh8OeFfEfi++OmeGbKW+uAC2yJdxwOpwKueJ/A3jDwW0a+KtNnsPO+55y7c/TNfo1+wv4QtvDvhbWPijq4Cx4MaMw+6sfLEfWu7/AGqdM0/4wfAa2+IGgJ5htJDNHt67d2xvw4Jr+g6PgvTnw3/antH7flc+TT4U9+5+t0vDem8meNdR+15XPltpypn5P+HPCviPxdfNpvhiylvp1XcUhUscevFV9f8AD2u+FtRbSPEdpLZXKAExyrtbB6V65+zh48PgD4saZqrvtgkkEUw7FX4/ma+s/wBv7wQiz6Z8QbNAyTDyZmHfj5K+NwHAuHxXDdXN8PNurTlaUenL32vs/wAD5rC8L0sRktTMaMnzweq0tZ7Pv6n5+eG/B/ijxjctaeFrGbUJUGWWFSxA96pa5oGteGtSfR9ftpLS6j+9FIMMM+or9Qv2HPCtt4U+HWsfEjVB5fm5QM39yMbtw/OvBPhF4Ug/aN/aM1LXvEI820tpGuJF6hkU7E/DgV9B/wAQmhLC5dCEn9YxLvbSyj37nqy4Cvh8Iov99Xd7dFHv38z5n8PfCL4l+K7YXnh7Rbq6ibo6Rkr+dYHiTwX4s8IXAtvE2nT2LnoJkK/zr9Mfjt+1tdfCjxMfAXw4sbdRZACRmX5OgwqgY6Vf0v42fDD9oP4VXmmfEw22n6mqMq5IHzY+VlJ5616OJ8O+Gpyq4HC41qvTT1kkoSa6JnfieEMklOpg8PiX7WF9Wkotrpc/JfP6V22i/Djx34j0t9b0PSrm6tIwS8saEqu3k5PsK5PUIIbXUJbeBtyI7AMD1AJA/Sv1s/ZMKD9m7WCwz8lx2/2Gr4jw04Ho51jqmFxM3Hkg5e7bVr16HzPBHDNPM8TUw9aVuWLd15H5K2Gn3up3S2OnxNNK5wqoMkmvUT8BvjCLL7efD175WM58o9PWvtL9gbwf4evoNa8U3kST39sypEGAJUMCe/qQK1PEv7V3xg8D/ESWx8U6KsOixTmMkxtnygfvBuh4r7PJvDDKaeVUcyzarNe1btyJNRV95dj6TL+B8BTwFLG5jUklU25VdL/EfmLe2t1ptw9rfRtFJGcMrDBB+lbnhzwf4o8XXH2TwzYTXsn92JCx/Svpv9oHxb8M/jP420q6+HimO7vJFhnGzYDvOAT05ya+1/GPiDwv+yB8JbC20O0jl1S5Cp8w5aQryzHrgGvKyTwxwNati8TiMV/stDecd3fZLz7+ZxZTwThalSvXr1v9npfaW7vtY/LTXvg78UPDFmdQ13Q7u2hAyXeMgAfWuG0nR9U12/TS9Ht3ubiQ4WNBlifYV+mXwe/bTk8Z6+3hn4sW1rDaXCsBKq4UH0YMT1rzOz0TwPpH7WGmS+ALmOfT7p1lAiOVRmPKjFdGK8PMlxEsPWyrEt05z5JRlZTi31t1RdbhDLa3sauAruUZSUWnZSXnY+KfE3hHxP4MvI7DxVYTWM0q71WVdpI6Zp3hnwf4p8ZXD2nhawmvpY13MkKliB68V90ft/aNqmofEjSJdOt5JVWyIJRSQDvPHFWf2BNJ1Kw8dam9/bvEDaMAXUj+JfWscN4W06nFTyFuXs+Zrmt0te+1jKjwIpZ+8qblyJtc1ulj4WtPAnjK+19/Ctpps76jHnfbhf3i7euR7V1p+BHxjHXw3ff9+jX3D8NOf24tX5z8lxj9K679oD9pL4sfDnx9L4e8KafDcWqIGDtEzHJ9wa93BeGGSU8tnmGPqVLKpKC5Em/d62t9562F4HyyGCnjMXOdlNxskunU/M7xB8NfHvhVIpPEek3Nks7hIzKhXcx7D3q3qnwo+JGi6W2t6rot1BaIu4yvGQoHrmvZfiH8d/iL8WdR0fSfHFpFaR295HLGY0ZSTkDv9a/YfUNB0rxb8PR4V1NVZb202bTxniteEfCPLM7+t/Uqk17NLk5kk22nuvXY0yDw9wWZ/WHhpySh8PNa7dtmumux/OhnHUV6BpHwq+I+v6Wut6Lot3c2jAsJY0JUgdTmpb34d63bfE1/huYz9r+1i2Ax3LYB+lfvT4Y8M6d4L8AQ+EtOKoLO0wVxzkjn8zmvJ8LfCCOePEzxknCNPRWtdy1017WPL4I8Pf7TdZ4iTiqemlvi1019D8ANB8A+NPFF3NY+HtMuLya3OJEiQsVIOCDXO3+n3ulX0umalE0FxAxSSNxgqw6g+9fp7+xbj/hZXi0bc/vpOv8Av14r4S+Ftp8Vf2rtb0zUwWs7a+mnmXoGVGB2/jXHPwpjWweBqYOTdSvOUbO1lbr56boynwGp4XDVcPJudWTVnsrdT5k8N/Cf4j+LrYXfhvR7q7iP8UcZIrH8S+BfGHg6QReJ9OnsSenmoVzX6a/Hv9qd/g1r8fw8+Gtjbq1ogEpdflXGRtwMc+9dl8KPiT4c/a18C6l4W8a2MUeowJ820ccjAde4wa+jXhXw/iMTUyfBYuTxUU90uRyW6TPZjwNlFevLLsJiG68e691tbpM/I7w14R8T+Mbp7HwtYzX0sY3MsKliB61n6vpGqaDfvpeswPbXEZ2vHIMMD7iv0V/Y38MzeDvjr4h8MTjP2OKSMZ6lVcYP418sftTJH/wuvWtvQTmvhc98P4YLIKOaSb9pKcoOOllZtadT5PN+FI4XKKeP5rzlKUWnto2eaaT8OfHeu6O/iDSNKubiyiBLzIhKAKMkk+wp3hv4bePPGFq994X0m5voY22M8KFgD1xX6f8A7NoH/DKWsbhkeVc/n5dQfsN3DWfwl168twC8VyXUEdxHxX32T+DOX4jE4OlUqyUatJ1Ha101ul5H2GC8NcLUrYenOo7VKbm9rq3Y/Or/AIUR8Y/+hbvuP+mRrz3XfD+t+GL9tL8QWklncKMmOUbWAPtX3hqn7Y/x5tNTntotJgaNHZVPkuTgH618b/FDx94h+JHiyTxF4miSC7YBGRFKgAfXmvzfjTJ8hw1Ff2ZKq53150rW8ra3Pi+JcvyqhD/YpTcr295WR56GBOKXcPyr1T4PfCTWfjB4qHhnRpUiYKXaR+gA9u9Y/wATvh7qvwu8Y3PgzWHV57fBLL0IYZBH4V8nU4cxcMDHMZQfs3LlT01fY+cqZTiYYRY2cLQbsn5mb4X8E+LvGpkXwpp09+YcbxCpbbn1rsf+FEfGL/oXL7/v0atfCH47eLvgvJdS+GIoZDdhd/nAnp0xgiv1h/Z4+M/if4o/C3UfGPiGKFLm0eRUEYIU7VBGcmv1bwz4I4ezuKoVqs1WSbkkly6a6O2p+g8EcMZRmaVCrUmqqV3orWW5+Qup/Bz4paNZSalquhXkEEQy7vGQAPUmsk/Djx4PDreLf7Juf7NRd7XOw+WF9c19G/ET9sL4k+KtO1HwhfQWi28xeIlVbdtBPTnFfXKW81z+w5eQWy75GsThFGSfmHAoyrgDJM0qYpZbVqNUqblqldyV9NOgYHhXK8dLELBTlanBy1turn5ExQyzyrBCpZ3OAB1Jrrdf+HnjjwtaRX3iHSrizhnOI2lQqGPXin+HfDXiBdfs3lsZgolQ5KH1+lfpr+22u34eeGlA581Mj/gC14fDXh7DGZRiswxHNGVLlsujv3ur/JHl5PwhHEZfiMZUbi6drK293b8D86bf4IfFy6gjurbw9evHKoZGERIIIyCKwtf+G3j7wtB9q8RaRdWcf96VCBX7D/GP4qeIfhH8EtG8SeGkjedoIExKCRgxg9q5/wDZ1+Ml3+0Z4c1fRvHmnQsYFClkX5GDg+uTkV+mYnwZyKWPWT0MRNV3HmV0uXa/a/8AkfcYnw2yr62ssp1pqs43V0uXY/GDPOMc16P4e+EXxN8V2wvfD2iXd1Cf444yV/Ovp74NfAbQ/E37RereG7pfN0rQp3Lqf4scoD7Gvb/jj+11e/C3xS/gD4cWNts0/CSs6/KOOAApHavicm8Nsvw+Almef1nCHM4RUUm5Nb79D5PLuDcLSwjx2a1XGHM4pRSbbW5+aXiXwZ4q8H3AtfE2nzWTt0Eqlc/nTvDPgnxd4zlkg8K6dPfvDy4hXcVz61+t/gHxf4V/a8+GN/pfiexji1G1Xa5UDIfGVZD1H515F+w5oU/hrx94p8P3Zw9kwiY+u0mvaw/g1hK2a4SnQrOWGxCbjLTmVls+h61Lw3w9XG4dUarlQrXcWlror2fT5n5xeIvDPiHwlff2b4ms5bG427vLmXa2D3wap6RpGp6/qEelaLA91cSnCRxjcxPsK/UP9vP4dRavoFl8S9JVZDat5Fwy85QnC/kc15p+wZ8No9R8Q3fxG1OPEGnjZEWHSQjr+RryK3g9UjxSsii37N683Xlte/byPNqeHc1nyylS93fm68vfsfFXiT4c+O/CECXPibSbmySU7UaVNoJ9BW7Z/BT4s6hapfWXh+9khlAZHWIkEHuK/SP9vLy28I6PPG4Ia7Qgj07V6T8RfiD4l+GH7Oml+J/CUCT3arbRhXUsNrHB4HNfWVPBjKqOOxtHEVZ+zoRUrqzbv5WPoZeG2ApYvFU6tSXJSinpZs/IDXPhZ8RfDVqb3XdGurWEdXkjIFcD1Fftl+zx8V/E3xr8N6nH8TtLigt4Fx5mwqjKeCDuzyB3r4S+Dfwi8N/Ef9oW/wBEtsPpNhPLKyjoUVyAB7Zr5nPvCSg54J5TUbWIbSU0lJW6u3Q8XNvD+lz4Z5fNuNbRKWkl8j5+8OfCb4k+Lbf7X4d0W6u4v76Rkj86xPEngnxd4PmEHifTp7Fj081Ctfpv8ev2rZPhDr4+Hnw2sbdTZovmM6/KPYAY5rtfhb498M/tb/D/AFHw54wsok1C2TD7R03Z2up6jn3r1n4W8PYnEVMowGLk8VFPdLkbS1Se53w4FyivXll+ExDdeN+is2t0j8i/DfhPxJ4vu2sPDFlLfTKNxSFdxx61R1rRdW8Oai+ka7byWt1F9+KQYZc88iv0A/Y58NT+Evj1rfhq6GWtI2T3xu4/Svnr9rfP/C+db+sf/oAr4TOuAaWD4fo5rKT9pKo4NaWVr/M+TzLhWOHyeGYN++5OLXTS54f4c8L+IvF17/ZvhmylvbjG7y4l3Ngd8U3xB4Y8Q+FL7+zPEtlNY3GN3lzKVbB9jXRfC3x7qXw38bWPivTXK/Z5F8xezpnkH2r9Jf2pPAVj8a/hjpvxa8FoLi4jRSRGMlo24I/4Cc0+GeBKGbZNXxWFk3iKWrjpZx7rrceScK0swy+rWw8n7anq46Wce66n5j+GfAvjHxl5n/CLabPf+Vy/koW2/Wsm/wBE1fTNUbRL+3eK7Q7WiYYYH0xX62+FLbS/2WP2dn1q/wBo1a+j8xh/E0jj5QPoMZFfO/7Fmi6V8QfizqXivxdtu71Fa4VXwQZGYEtj2ycV9NiPCHDxxuCyhVrV6qvPZqKav5O57lbw+pRxWGy72lq1TWW1ort5s+X7T4E/F++sv7QtfD968RGQwjPIrzjUtG1XR75tM1S3e3uEOGjcYYH8a/Un4x/tJ/Gv4cfECfT7LREGi20mFYxsQ6A9dw4rwT9pD4v/AAn+L9npmo+HYzDrELL5vybcg9QTjnBrHivgLIcNSqRwuInGrTaXLUVubWzcdPzMs/4VyqjTnHD1ZKpB2tNW5vOJ8423wQ+Ll5bpdWvh69eORQyMIiQQeQRSXPwR+LlnA91deHr1I4xlmMRAAHc1+uXxV+Ivin4ZfA7RPEXhCBbi6MFum1lLDBjB7c18Pa7+2D8c9Q0i5sdQ0uBLeRCHYxOCARyck8V7nFvhxw3lM3QrVKrny3Vkraq6uz1OIuDsly6ToVJ1HOyeiTWq6/M+HGyjbGGCODRRI7SytL/eYk496K/nF26H45fXQ734Y+IpvC/jrT9WhOAkgDD1B4r3j9rm6Nx4q0+E/dWEsB/vAV8saUduq256/vF/mK+jv2oHaTxHprt1a1Qn8q/XcozKrLhDF4V3sqkLL+u9j9Ay/FyfDuIo30U4v/M0P2LZY4vj5p0kjBAsNwMnoPkr2b43/tcfFHwr4+1Twh4fkto7eBtqSGPc+CP72a/PC2u7qzk+02UjRSDI3KSpGevIwabNLNcSme5cySN1Zjkn8TXk4HxIxuEyaOVYKTg+Zycoys2mrcvyscGB42xOHy6OAwzcXzNuSdrprY+4/wBkXTbrx38Xbn4jeLJvtB05WnaSQ8+b1Xr7Zr2t/wBq34R/8LW/tH+wV+3rN9mGoZ+bZnBPToK/Li21DULHK2M7whvvbGK5+uMVWLZbdnn1PrXsZR4v4zL8HRwuDik4ycpN2blJ+u3a56GV+IeJwWFpUMLFJxk5Sb15m+uuqa2vc/R74+fDzwHP+0Dput+LJvI0XX4t8s0TBSJsfLz9MV6Z4X+Dnxe8E+NoL3wN4nWXwqhVtk1xuGzuNh61+T1xqOo3exbyeSXZ93exbH0znFaCeJvEcdv9kiv51j9BI2P5134HxUwMMZVxc8JZylzrllZpvo3bWN9tDuw/HmFhiZ4iWGd3LmVpWd+qfdeR9R/tna94S134o+b4ZMckkcSLO8eMFgOmR3FV/wBmrw7491Rbq/8ABniVdFERG+N32rJ6ZGRmvktneRzJKxYnkk81Jb3dzag/ZpXjz12sRn8q+Kjxkp5zPNsRT+Jt8qk42b21Wp8wuJebM5ZhWh8TeidvxR+wWuW/imfwhqK+P7rRda2W0u1tqrICEODk5yc1+PUpwzdOtWW1TUypjkuZWB65dun51RCjpW3HXGv9sSpyUHFxTWrbd/Vi4q4m/tGUGocvKmrN33P0e/ZcuYIvgN4wR3CsYyME/wCya2v2UbzRb34X+INA8L3MVn4onaQRu5CuVx8uD1xn8q/NOG/1C2jeGCeSNG+8qsQD9QDiktb69spvtFhM0LjuhKnj3FfSZT4rrDPDJ0dKdN03rq023dPo1fQ9zL/EKVGVC9K6hBx31s23ddn5n64+EdN8T+AvhN4gt/2itThvop1byEllExzt4wT6t7V8qfA34b2PxL8F6rp/hvX5dN1cFvLtTJsjkU/dJ55GOvFfI2o67rWqjGpXcsw9Hct+hNUrS+vNPl+0WEzwuOhRip/Q0Zh4m4bEYmhz4a9KnFxs5Xk09buW9100DG8dUatWmpUb04xcbOXvO/8Ae39D9R9F0S9+AXwA17QviXqEU1xqKOlvbJJ5gDMMDHue9flexDsXHc5x7VqX2taxqzbtUupZz/tuT/OsndjgV8rxtxfDNPZUqVPkpU48sU3eW99TwuKOI1j3SUIcsaasru7t5vqPT5csOD1Ffsd8LpWm+HeiyN1NnFn/AL5FfjiO30r9ifhR/wAk30T/AK84v/QRX7/9FT/e8Wv7qP1nwGiliK6X8q/M9Booor+1z+mT/9T9eKKKK/xvP85wooooAKKKKACiiigAooooAKKKKACrVjavfXkVnGu5pXCge5NVa9F+E+veF/DHj3TvEHjFZHsLWQSOsS72bHQYyK9PJsPSq4qnCvLlg2rt9FfVnXl8KUq8I1naLau3skfsxY/C+fSP2fIPhrYXcWn3NzaeXJLIdoLOPmP15p3wk+FU3hn4U3fww1nUYNSV1kRDE27ajrjGPrk1+df7Tf7TNp8Vb3T7fwHLd2lpaAlt48tmLAcYB6DFcf8As6/tA3Pwt8df2v4ruLq50+WMpKoJdh12kAkDrX9fvxgyCOdRoRpXpKPs/aXduS2ulrW8z+h5eJGURzNYZR9xL2fPd2tbtseH+L9Cu/BXjW90ZkMb2NwwTPXCt8pr9ZL62T9oP9lGGSIefe28S+5M0XH171+dP7Rfj3wT8SviFJ4u8EJMiXSASrOmw7wMcDJ617N+yt+034a+DmjX2geNFnktpWDwiFd2Dzu4JHWvy3w7z7K8vzfF5di6y+q1lJc2tu6PhuDM0wGEzDE4GvUToVE1fpvoz6h+Md4nwO/ZetfB8BCXVzAtuexJf75+oBr59/4J8ataW3j3VtNuWCyXVoBHnqSHyR+VeZ/tVftBaN8bNVsY/DKypY2ak4lXaTI3B4BPbFfOvgnxnrnw/wDFFt4q8PyFLi2bcPQjuD9RXVxB4n4SjxdRzDDPmw9C0Fb+W1rr72zpzfjjD0+IaWLoPmo0rRVu3VnsP7UvhjVvDnxg1U6jGwSeTzI3IIDK3Iwfasz4efs6/EL4kaDL4k0SAJaQ5y8nyggcnBNfbdr+198CPH2nQf8AC09E33kSjrCJVB74ZsEZ9K88+Ln7Y3h648JSeBvg9p5sLWZGjaTaItqnrsUevrTzPh7hKFWvmlTGe0hK7jCKfNd92TmGUcPqrVx9TFc8Xdxgviu+5+e13bPY3klm5BMbFSR6qSDX65fsmDH7Nmsg9Ntx/wCi2r8iXZ5HLyHczHJPfJr7u+Bf7S3gH4b/AAg1DwJr6XLXlysoUxxhky6kDnI9fSvmvBniDA5dmVavi5qEHTklfu9l8zxPDXNsLg8bVniJqKcZJX/I8x+AmnfH3w+JvHvwqtHuLJPlnGV2tt7EE5/SvqnwR+2LofjfWbfwh8SfD0bTTuISwQOAxOOQ3PX0r5d/Zt/aUm+CtzcaZqlubvSrsgugOWQjjIH06jvX1cn7Rv7Jtnff8JbZ6Ji/zvH+jKGD+o56+9foPh9n+BoYOi8LmXsrO9SnUTa3+ytlc+v4OzXC0sNTqUMbydZwnqn/AIdDjf2iPhL4O+FnxN8L+OfDsa29rf3sQli/hUhg24enFdd+3zoOo674X0bxZpaNNZxnDMvIAYbgx9q+Pv2i/wBoO++Neuwy2kRtbCyJ8lP4sn+I+h9q93+D37Y+i6Z4Ui8CfF6xOoWkKiNZQokJQdFZTwcVMuMuH8wq5hk8J+yoVmnGVtFJd12ZL4hyfFTxuWuXs6dVpxlbS68vN6nxf8Pfh14n+JviBfD3haEvKwz04UD1Pavof4ZfDHxB8J/2h9D8NeJdv2hisoCHOFJ719JXP7W3wC8A2M8nww0PZfSr8uyFY157Flyf0r4t8MfGqWX42QfFHx47yKsu9ljG4qv91Qewr5ZYPhzJsVhFSxHtaymnKSuoRj5q39WPBjhcmy2rQ9nX9pU503JfClfY/Sz9o39onRfg/wCKLPRdS0WPUWuYDKHdQSo3YxzR+zn+0Jovxc1670rS9Gj05oITIXRQCRkDHH1r89f2q/jN4V+NHjGw1zwoJljtrYxMJk2HO7PAye1T/ssfGjwl8FvE17rHi5ZniuIDEogQOdxIPTI9K/QMN40VP9bZQqYlfU+Zq9la1tNbXPsKXiVJ8QSj7dfV03rZWtbv6n0r8N+P25tYx/duP6V6T8c/2oND+GfjmTw1qOhxX0iKG8xlUnB+vNfIng/9oDwVof7SeofFu8juDpl0swQKmZPnxjK5r6G8Q/tRfsp+KtRbVvEOgz3dw4wXktlY4+pNdeQ8bYP+yquHw2PjQqOrOSck3eLenyZtlXEuF+oVKWHxcac3UlK7V9G9D5W+Kvxu0r4v+KNFbTdMTTvs08YO0AZyw9K/RP41fECb4caV4Q8QhisAuYo5h6xsORXwP8bPip8BvEsOkN8MNIfT5rS8SadjAsZMY6gEHn6VuftH/tGeBvit4B0vw34XS5W5spEdjMm1flGDg5NfPZdxvRy6hmNSWLjUrNwcZJNc1mm7emx4+G4pp4OnjZyxMZ1G4NNaXtukj7yn+CGjXnxri+NqlDbC13FeMGTGQ/1FZvwY+IUnxH1PxlrKOXt4pnhhz2VVAP65r5EsP2xNPtfgOfAkiTnXBbG2Em35MEYDFs9fwrk/2Zv2ivBHwj8L6tpHixLmS4v3ZlMMe8fMBnJyMc19pDxVyKGYUIYSooUpxnOb1t7SS29dz6ePHeVRxlOFGahCSlOT/vNaL13PdP2LOPiZ4sPrNJ/6HVP9nnWLOx/av8W6ZcsFa4nuNme5B6V4n+zv+0P4H+FvjHXdd8Rx3Jh1CRmi8pAxAZs/NzxXgOu/Ey6h+MF98S/BzyQeZetcwkja20nIDD3r4TD+IuAwWByydGfNKlUk5RSd1F9duvQ+T/12weEwuBq05qThOTklvZrU9y/aF+FXiDWf2i77Siy239ryCS3klyEORgLn6ivp39kH4K+NfhR431248WReXCLVYlk6q53Bsg/SsrRv2yfg34y061b4q6Mf7Qt8EOIhIFdf4lY4wc166f2lvhx8VfCOsaH4Q1X+yLxITHE10AmeOCvPTtntX2nC2D4Vo5hPN8NilKs3KUI35Xqm3Fp6b9T6fIcLkFPGyzGjiFKpdySvZ630afqeYfs/a9p+tftT+Kp7JgR5ci/UqwBr4u/at069svjZqz3cbKJpNyZH3ge49a4rwF8Q/EXwe+IreI7B/tE0ErLNySsoz83PcHrmv0HP7WH7N/jqGPUPiBoe+9jUZMkCyAH0DGvhcNnGWZ9kiy7HYhUKkKkp+8m4tS/yPkqOY4DOMsWBxddUakZylrs7nQfs+W1zpf7J+rSXqNEJLe4ZdwxkGPqKp/sKXYtPhFr19IN4juS+PXCZrwf44/tg6R4p8KP4C+GFmbOykTy2kK7CE7qqDjBHFVf2XP2kfh/8IPBd94b8Yw3MrXUwceTGGUrt2kHkV9hkviDk1HPcNQpYj93RouHO72cu/oj6nA8X5bHNaFKnV9ylTlHm6XZ3mo/tteF7W/mtJPDMLGNiudi84PXNfAnxF8Uw+NvGd/4mtYBapdyGRYwAAoPbAr9B5f2g/wBjiaRpp/DEhZskk2qHJ6+tfDvxn8S+BvFXjZ9W+HdobLTmQARMgT5hnPyivy3xSzWpisLBzzGGISlpGKaav1ba7HwfHuYSxFGPPjYVbS2irNHIeDfF3inwZrSaz4RneC7AIBjGSQe2Oc1U8TeINc8U61NrXiSZp7yU/vGfrx2x2x6V61+zr4+8FfDvx4Nb8dWQu7TYVGVD7WOedp965741eLPCvjf4jX/iPwba/ZNPn2hE2heVGGO0dMnmvzfFYeksnhWWJvJy/h66afFvbXbY+GlRh/ZsKvt7tya5O3975nlPtX60fsWAf8KG14f9Npv/AECvyWY46V9z/s8/tI+BPhV8MNS8IeI47lrq8kkdTEm5QHXAycivs/BjPsJl+YzrY2ooRcJK72u1ovmfU+GmbYbB46VTEzUVyy1Z8W69/wAhu7/67yf+hGv2c+Gviy38C/snR+Lru3F1HY2zO0TYIYAjjmvxZ1K6S91Ge8iH7uSR3GeuCc/1r7nP7SvgA/s03Hwh2XP9pTWxiDeX+73Eg/ezXq+EnF+GyqWOrVKqhOVN8l+stbW3O/w44hw+CeLqTmotwajfq+h3+mfts+F7/UobOPwxCrSMFB2JwSa9D/bklFz4I8P3WNokuA2PTIHFfk1ot3Fp+r299MDtikViB1wDX23+0d+0n4C+K/hXR9H8NR3Sy2Dq0nmxhR8qgcYJ9K+iybxXnmGQ4zD5vXTm3HkVrNq+uy6HrZfx/LF5RiqeZVVzO3Ktup96eP8AX/ht4e+D+jXvxOtTc2H2eABcZw3lioNU17w54G+B9z4++DOnRPDJD5oVBgkY6tjkkV8KfHb9pTwF8SPhJp3gXQUuhdWiwhzJGFXKJtODk96g/Zs/ai8P/DXwre+CfiJHPdWEmfIESeZjdneCCRwa/Q8R4u5bVzOpg1VjGlKmkqiWsZW6ytqulj7Ov4jYKWPnhY1YqEoWVRJXUrdWdz+wl4sbU/iL4hOryhr3VEEgLdWKli386+Yv2n/Der+HfjLq51CJglxL5kbkYDKQOQa5OLx/aeBvijJ4y+GDypbRTmSASjaxQnlGHPB6V982n7XPwF8f6dC/xU0INexLzuhWVQR6MeefSvy3LcwyzOckhkuYYlUqlGcnGTTcZJvX9bH57gsZl+ZZXHK8TiFTnTk2pPVNFf8AYE8P6jpeka14pv0aK1cBUZhgNxkkeuMVu/sr39vq3xo8d6jandFPcOyEdCCTXlXxY/bK0G48KP4L+Dunmwt3Up5mwR7FPUKoyOa8o/ZX+OvhH4N6lqd74uW4k+2qFTyUDnIznOSPWvrcq48yPL8dl2WUK6dKgpc03s5NW0PpsBxXleExWDwNKrenSvefS7XT5n3J4H1i0+KyeOvgzrDB5beeQwbv4UdQEwP9lhmsbxTDB+zb8EtM8C2MgXUL+5SMuvVmZ8kn/gHFfEXgz496f4Q/aEvPifZpMdMvZnLpj5zGwxyueo7CrP7QX7QOn/Fr4iadrejpMmlaeUISRcNkOCTtz1/Gn/xFfAPK5VVL/ak3TT1v7NyvzbbW0BeIGA+ourzL29+S/wDc5r3+4+s/212DfDrw6Og86L+VeufEX4kyfC39nbS/FEdhDqGxbaPybgZQ7zjP1HaviT9oz9o3wJ8VPCOk6J4ajuVmspI2kMqBRhRg4OT+Fe42X7X3wBv/AAFYeDvGOn3V4lvEgkjaBWTenQ8tg179LjzK5ZjmNSjjI0/aQioT1te3p0PXo8WYCWOxkqeJjBzjFRl0udp8C/jNpX7R9hqngPWdKGmKsW8mzJRCDkdQRzXnX7M/h2w+Fv7S/iTwBLNvBt8Qux+ZtxVwPyqxD+2N8B/A2nzn4Y+H3hupFxjyVhDemSDnGfY18Cy/Fzxa3xLb4owy+XfvN5nHQDpt9xt4r53P/EfLcFVy+vKv9Yr0ZNzmo2916W213v5WPFzbjLBYepg6rqqtVpyfNJK3utPQ9K/a28MavoHxj1Ga/jYR3BEkb44Ib0Pevpj/AIJ++HNStH1rxRdoY7No1RXPAYjJOK2rH9sH4IePdLgi+LOieZdwjGTEsqg45Kk9M+lcb8Tv2y/DMPhWTwZ8GtONjDKpQy7BGEB67VHf34rly+XDeU5rU4jpYxTTu400nzXeybvsc+CeSYHMZ53DFKa1aglrd9Gdh+z5qtprf7Vnii/siGidSARyPlIB/UV8i/tbrj49a1jqWi/9AFWv2YfjL4a+EXjq68T+LlnkjniKkxLvYsTkkjI619Z65+03+yd4k1SXWNc8Pz3NxNjdK9shY44HOa8547Kc84bp4OvjY0aiqSnrfZ+i8znpYnL80ySGFq4mNOfO5O+tr3PyvdV5A61+of7BfxIvtQivfhvqQM1vEvmw7uQM8FcHtxXyD+0B42+FXjLWLS4+F2nNp0MSsJFaIR7ienAzW1+y58YvDHwd8XXOt+KkmaKWLYohXec/TIr4nw4zXDZFxPB/WV7JPlctbONvPU+X4Ox1HK89i1WXs9nLo0dx+2z8Sr/xJ8SG8EpmO00kAbezOwzu/AHFeR/AjQPjNPrUnij4P28k09lgSlGUDB5wwY8g1znxu8baP8RfifqXjDQd4tbtlKeYMNwoByO3Sum/Z/8AjpqfwR8TvqUcJubK5GyeLOMj+8PcVx/25hMbxRPG5hWkqcpu04vVJaRa0e2hyvNsPis9licZVag5P3o7rsz690b9taddSPhP4w+HUeaF/JlCKHIOcElW4/Kk/a1+DHgiy8N2HxS8H2wsmkdDLGowrB8Y+Xseea6C4/aQ/ZO1y7/4SnWtELagDvYtbruLeue9fN37RH7UafFn7L4f8N2zWuk2zhvmGGfHQY7AV+x8ScV5dHJq2Hx+Njipyt7O0fejqtW7b2/I/Rs64gwSy2pQxeKjXk7cll7y16vvY/Q74jfE6w+FXwU0TxBf2S36GC3Ty2AI/wBWOxr4f8fftf8Ahrxh4P1Lw1a+HorZ72FohIEUbSe+a9kX9r/9n/WPBun+FfF+m3V8lpBEjJJArLvRQCQCa4fXfjr+yHe6PcW2m+GniuJEKofsqDB7HOa9jjnjOhjozeCzWnCly2cXFtvTXW3U9PijiKGJUng8fCMHFLla121V7H5vZ6kdzTqWaSOSZ5IuFLEge2aZuI61/FzXbX0P5rbtodB4T0641XxFZ6fbDLvMuPzr6I/auhEPiyyhHRbdQPyqf9lr4fza14mPi28Q/Z7E5Q44Lnp+lbH7YOnNBr2m6ieEmRkz/u4/xr+hMPwnWwvAdbHVFb2k4tJ/yp2TP1qGQVKHCdTFTVueSfyWn6nzJ4I8EeIPiJ4ji8MeGIDcXcqsyRg4yFGT146V7Rf/ALJPx0srZ7mTRXZIwSwVkJx+dbv7FIUfH/TjycwXH6JX2Fp+h/tDJ+0ZcahH9sTw35uSZ2P2fZt52gkjrWfAHhxl+YZVSxNenUlKpNw9xq0VZNN6PTvqh8K8HYTGYCGIr05SlKbi+X7K01emx+S+oafe6Xevp17E0M0bbWRhgg+lexr+zt8V38Ff8J8umv8A2b5JuPM4/wBWBktjOele2/H3w9pPj39qaPw54VCk3LwxyGP7u8DLdO/rX6AjxzpK/EBP2fTBi0bTepHy8Ljbnpz6V0cI+E2CxlbFxxdR8sZunTcdpS138tCuHvD/AAlariKeIm2oycINdZf1ufiP4R8Ja3441+Dw34ciM15PnYnTOOvXit74gfC7xn8MNQi0rxlaNayTKXTcQcgHBwQa+h/gx4VufBX7Vsfhu5GGtbmYDjsQWGPwNfWf7YPhWw+Jvgq61PRVD6j4emVJVXltrjhfxyDXl5R4W08RkFfF3f1inJpLo0t9O/n2OPA8BRr5TWxSv7aMmkujturfI/Nb4e/Bn4hfE+2nu/B9i1zFa4EjAgAZ+przzWNKvND1SbSdRUpPbMUdfQiv21/Zz0PTPhl4G0zwXOAup6nayXsgP3gODg/TOK/H34tKB8S9Z/6+nH61w+Inh3hsmynB14Sbqz0nrs0k7L9Tl4x4Oo5ZgMPWTvOXxX2TPOTtI96XI2nBr73+DP7I2ieNvBFr8QNZ1V3jnUuLO3VWkIUkYzuBycVxfxu0r4YeDvDh8PeF/DeoWV55nzXN6uDwO3XrXh4rwwx2Gy7+08VJRi48yWrb/wDAbr7zycTwHiqGD+u4mSimrrRu6+V7fM+QIIZJnEcSlmboAMmvUtc+C3xD8O+DIvH+rWDwabNjbI2M/McDjqKwPh54wt/A3ii38RzWUeoCDJ8mb7p/Q1+knx28ZXXj79ke18UXkSQPdPCxjT7qjfjA/Kt+DuEstx2WYrFV6j9rTi5KKWmltW9/kjTh3h/B4vL8RXnN88ItpL5dT89vAfwd+IHxJW4k8KWD3Edsu+RzwoA9zjP4Vxtn4X17VNf/AOEW0+3ea98wxGNBk7gcYr9R/wBkf4wy+N7XUfBkGmwafbabp24mLrK+Qu5uB2rgf2TdD01viX4x8V3CCSewafy8jO0sS2R78V9hhfCzLcSsv+q1ZNVnLnk9NI6uy+9at9z6WnwJgsQsGqE3apzcz8o9kfMOu/ssfGnQdGfXbrSn8uNN7hSCyj3A5r53kV0YowKupwQa/QX9nj42+O/E3x7msdbvZbix1F5UNs7EoozgbQemPpXzZ+0j4esvDPxp1zTNOURwiUMqjoNwBP6mvk+MuGctjldPNsq5lBzcHGTu7x1vey3W6Pn+JMiwawUMwy/mjBycGpO/o0eGD+lfsV8Kv+ScaL/16Rf+givx6giaaRYV+8xCge5Nfsn8PLN7DwJpFnKMPHaRKwPGCFGa/ZvoqUpfWcVPpyx/r8D9J8BYP21eXSy/M7Kiiiv7TP6VP//V/Xiiiiv8bz/OcKKKKACiiigAooooAKKKKACiiigCJgd2RUmSBnvS0URundMBo3beDikIbGc5p9FDUXq0O77kZ+n5UZ9RUlFU5N6k2I8A9QRThkDPenUVK7vcIq2xHhj7Zo2lehzUlFEtXd6hykabgad8wPtTqKcXYYgLetN2kcg0+inzu1geu/6kYG04FO6cA06ijmEkMKZo7Ybmn0UrhZDDwflGKMH1p9FHmHKhg3etO+b1NLRRdjavuR/MD8velAKjAPSn0UlZO4lGzuiML827vTiWxinUVTlfccdFaOgwbxxRtI4B4p9FTZWsxoYdwGKVHdM7cjPpxTqKak1ZLbsS1rfqN+c5JPekwwOafRStbbQbGEcZHFIVZhgk4qSim7dCXFPcYNwXCkjFG0nnuafRQ3caWliI7h0qQdKWii77gopCFQetMYYPTNSUUlZO63FKFxnsOlJt7gc1JRTi7ajcb7jB6mjBXhT1p9FNybCwzgHpQSR90c0+ilzO9xpu1hhD9jzS89Sc06ii67DTZG27O8d6U9OlPoqlNrYloj/eEcHBpSX7Gn0VHSw1ddSPDg8Gg5PJ5IqSihpMFdbMj2Ecgn6U7GBg806inF2VkLlW6I+MfKME0oRlHDU+ikvQdle//AGksMUgLHrkYp9FVzsTV9xuO1Jlu9Poo5n0KvrcbgZ+XikwQODT6KTs9LCGZY89O1GW/iNPoocm9wWjuNC46GkwN3PJp9NbniiHMvhJaW7GN8wzXaeB/BWreO/EEOi6VGWLkbmHRV9TXS/Dr4Q+KfiLeLHZRNFbZ+eZgdoHse/4V+lXw4+GHh74b6X9h0tA07f6yYj5mPf8K/oLwn8E8TnNaOMxsXGgrPVWcvRPp3/A/W+AfDLE5hUjicUuWle+v2vK36m34I8Iaf4G8OW/h/TVwsQ+Zv7zHqa8c/ae8IP4k8AnU7VC02nt5g9k6t/KvpKql9aQX9pJZXSh4pVKsp6EGv7g4m4Sw+OyeplKVoONl5W2+5n9P55kFLF5dPARVotWXl2Pza/ZI8QaJ4Y+Nun6r4iuo7O2jhnDSyNtUEpgDPua3/jl+0H8RJPiDqun+E/EU50oviIQONhUjnBryf4z/DK9+HfimWBVJsrgl4ZO2D2J9a8c255Jr/OfOc+zbK8I+Hppw5JttptN3SXfVWXY/jrNM1x2Aw7yaS5HGTd1dN30+4+z/wBkC/8ACem+Pbvx1461GGBrSJmi+0OAzynkEZ616S37cWrL45My6bbGyFxs80r+88rPXd9K/OhOuc5pu3+ImtMs8VczwGCo4PAvkUG5NreT033X3JDwPH+OwuGpYfCvlUW27fav3P1J8Xa/8NW/aW8O/EjSdXsza3UJ+1MsgISTaTlvTjAqbwr8bvB+l/tH+ItP1K/gl0HVljKylsw+Yijknp2xX5Y5DHHrRsx3r2YeNONhWVWjSjG1RzaV7Xas1q9mej/xErFRqe1p00vfc+uras1vt+p+pvg/45eFde/aY1LWNS1GG10m0sZLW2d2AjJGPun3xX53fE6+tdQ+IOrX1k4likuWZXXkMp7g1weCDhelGM9/8/nXynEvH+KzXDRw+IitJSlfq3Lfr0toeHnvF9fMKMaNVK6k5X9f0XQ+4/g94e+F1h4Ws9cm8bT6NqUqkyxRsRsO44Hp05rqPj7428OX3wxOiad4qGuzeYDiRcy4A7tX56jI4FIevWvQfiXVWXywFLDximuVtc1//SrX+R0/66Sjg3goUYxTVm1fX8bfgLGCSOMEV+gPjHxn4SvP2O9O8KW2oQPqMYi3W4ceYMPz8vtX5+kDbS4Jwfzr5vh/iepl9HEUKcE/bR5X6PqrW1PHyjPamDpVaUUmqisz7d/Yr8XeGPCPiPxBceJb6GxjnsCkbTMFDNuHAzVT4AfGPQvh58YNZi1uUf2Vq8k0bSDlQWbhvpivi0DtnpSDGPm619Bl/iTi8NTwkKMUvYOTW+vM9Uz1sHxriaFPDwppJ0W7Pe/Numfqp4P8BfBT4P8AjS9+MA8UW13b7ZHtbZDllL/j8x9OBX51/FTxq3xC8e6n4vKlTdzFlB/ujgfoK4NpZ5E8tpGZR2zwPpSRRyTOIYVyzEAAdSTWHFHHM8zoU8Bh6EaVNNvljd3k93q2yM+4onjqMcNRpKnBNuy1u316/I9J+EfhObxh46sNMVSU8wPIfQLzk/iK/X2NFiQRIMBRgfhXzL+zd8Km8HaGfEmrJi9vV4B6onUfnX07X9yeBPA88myZPEK1Sp7z8l0Xr/mf1B4W8Lzy3LVKsrTqavy7BRRRX7UfpZ//1v14ooor/G8/znCikPFM3kmglyS0bJKKbux1qaONpW2xgkn0FaU6Upvlgrs1o0pVJKFNXbI6K3Lbw7qt0AUiOD3xWvH4F1iQZyq+xNfX4Hw8zvEx5qOGk16f5n6ZlPgvxVjoqeFwFRp/3bfnY4yiuyk8DaxEMnaw9jWPP4e1a3YiSFsDvipzDw+zrCq+Iw0l8jPOPBzinAK+LwFSK/wt/lcxaKllgnhJEiMPqKg3Ada+Uq4edN8s1Z+Z+eYnC1KMnCtHla7jqKQHIzS1ic6YVHnJ46VJTDw2SMgU0m9CZMBjGVI/Gl+b1H5192/Cj4L/AAk+IvhKHWvLuBOBtmUS4ww/DvXpg/ZX+FH/ADzuf+/3/wBjX9CZT9HfOMbhqeKw1Sm4TV1q+v8A26freA8HsxxNGNelOLUldas/Mb5vUfnR83qPzr9Ov+GV/hT/AM87n/v9/wDY0f8ADK/wp/553P8A3+/+xr0f+JY8/wD54f8AgX/2p2f8QPzX+aP3s/MX5vUfnR83qPzr9Ov+GV/hT/zzuf8Av9/9jR/wyv8ACn/nnc/9/v8A7Gj/AIljz/8Anh/4F/8Aah/xA/Nf5o/ez8xfm9R+dHzeo/Ov06/4ZX+FP/PO5/7/AH/2NH/DK/wp/wCedz/3+/8AsaP+JY8//nh/4F/9qH/ED81/mj97PzF+b1H50fN6j86/Tr/hlf4U/wDPO5/7/f8A2NH/AAyv8Kf+edz/AN/v/saP+JY8/wD54f8AgX/2of8AED81/mj97PzF+b1H50fN6j86/Tr/AIZX+FP/ADzuf+/3/wBjR/wyv8Kf+edz/wB/v/saP+JY8/8A54f+Bf8A2of8QPzX+aP3s/MX5vUfnR83qPzr9Ov+GV/hT/zzuf8Av9/9jR/wyv8ACn/nnc/9/v8A7Gj/AIljz/8Anh/4F/8Aah/xA/Nf5o/ez8xfm9R+dHzeo/Ov06/4ZX+FP/PO5/7/AH/2NH/DK/wp/wCedz/3+/8AsaP+JY8//nh/4F/9qH/ED81/mj97PzF+b1H50fN6j86/Tr/hlf4U/wDPO5/7/f8A2NH/AAyv8Kf+edz/AN/v/saP+JY8/wD54f8AgX/2of8AED81/mj97PzF+b1H50fN6j86/Tr/AIZX+FP/ADzuf+/3/wBjR/wyv8Kf+edz/wB/v/saP+JY8/8A54f+Bf8A2of8QPzX+aP3s/MX5vUfnR83qPzr9Ov+GV/hT/zzuf8Av9/9jR/wyv8ACn/nnc/9/v8A7Gj/AIljz/8Anh/4F/8Aah/xA/Nf5o/ez8xfm9R+dHzeo/Ov06/4ZX+FP/PO5/7/AH/2NH/DK/wp/wCedz/3+/8AsaP+JY8//nh/4F/9qH/ED81/mj97PzF+b1H50fN6j86/Tr/hlf4U/wDPO5/7/f8A2NH/AAyv8Kf+edz/AN/v/saP+JY8/wD54f8AgX/2of8AED81/mj97PzF+b1H50fN6j86/Tr/AIZX+FP/ADzuf+/3/wBjR/wyv8Kf+edz/wB/v/saP+JY8/8A54f+Bf8A2of8QPzX+aP3s/MX5vUfnR83qPzr9Ov+GV/hT/zzuf8Av9/9jR/wyv8ACn/nnc/9/v8A7Gj/AIljz/8Anh/4F/8Aah/xA/Nf5o/ez8xfm9R+dHzeo/Ov06/4ZX+FP/PO5/7/AH/2NH/DK/wp/wCedz/3+/8AsaP+JY8//nh/4F/9qH/ED81/mj97PzF+b1H50fN6j86/Tr/hlf4U/wDPO5/7/f8A2NH/AAyv8Kf+edz/AN/v/saP+JY8/wD54f8AgX/2of8AED81/mj97PzF+b1H50fN6j86/Tr/AIZX+FP/ADzuf+/3/wBjR/wyv8Kf+edz/wB/v/saP+JY8/8A54f+Bf8A2of8QPzX+aP3s/MX5vUfnR83qPzr9Ov+GV/hT/zzuf8Av9/9jR/wyv8ACn/nnc/9/v8A7Gj/AIljz/8Anh/4F/8Aah/xA/Nf5o/ez8xfm9R+dHzeo/Ov06/4ZX+FP/PO5/7/AH/2NH/DK/wp/wCedz/3+/8AsaP+JY8//nh/4F/9qH/ED81/mj97PzF+b1H50fN6j86/Tr/hlf4U/wDPO5/7/f8A2NH/AAyv8Kf+edz/AN/v/saP+JY8/wD54f8AgX/2of8AED81/mj97PzF+b1H50fN6j86/Tr/AIZX+FP/ADzuf+/3/wBjR/wyv8Kf+edz/wB/v/saP+JY8/8A54f+Bf8A2of8QPzX+aP3s/MX5vUfnR83qPzr9Ov+GV/hT/zzuf8Av9/9jR/wyv8ACn/nnc/9/v8A7Gj/AIljz/8Anh/4F/8Aah/xA/Nf5o/ez8xfm9R+dHzeo/Ov06/4ZX+FP/PO5/7/AH/2NH/DK/wp/wCedz/3+/8AsaP+JY8//nh/4F/9qH/ED81/mj97PzF+b1H50fN6j86/Tr/hlf4U/wDPO5/7/f8A2NH/AAyv8Kf+edz/AN/v/saP+JY8/wD54f8AgX/2of8AED81/mj97PzF+b1H50fN6j86/Tr/AIZX+FP/ADzuf+/3/wBjR/wyv8Kf+edz/wB/v/saP+JY8/8A54f+Bf8A2of8QPzX+aP3s/MX5vUfnR83qPzr9Ov+GV/hT/zzuf8Av9/9jR/wyv8ACn/nnc/9/v8A7Gj/AIljz/8Anh/4F/8Aah/xA/Nf5o/ez8xfm9R+dHzeo/Ov06/4ZX+FP/PO5/7/AH/2NH/DK/wp/wCedz/3+/8AsaP+JY8//nh/4F/9qH/ED81/mj97PzF+b1H50fN6j86/Tr/hlf4U/wDPO5/7/f8A2NH/AAyv8Kf+edz/AN/v/saP+JY8/wD54f8AgX/2of8AED81/mj97PzF+b1H50wk561+nv8Awyv8Kf8Annc/9/v/ALGgfsr/AAp/553P/f3/AOtSf0Ys/f24ff8A8AmXgdm3SUfvf+R+YpUjrxUsVtcT/LEjP9Bmv1Osv2cPhZZEFLR5Mf333f0r0HSvhx4G0XDadpcEbj+IKM17WWfRYzCcl9bxEYrrZNv9EevgvAfFSlfEVkl5XZ+WPhr4UePfFLqNM0+Qp0LEbQB684r63+Hv7KdhYSRan40lEzjB8lOn4mvspI0jGI1Cj2GKfX7Xwh9HvIssmq1ZOrNfzbL0X/BP0zh7wkyvBNTqJ1Jf3ijp2mafpFothpkKQQoMBUGB+lXqKK/dIQjFWirLyVj9RjBRXLFaBRRRVpXHc4rx14F0Xx9ocmi6wgIYZR8fMjeor8yviV8GvFXw8vnNxCZ7Mn5JlGRjtn3r9avpWXrC6Q+nSprYjNsR84kxtx+Nfj3if4T5Zn1J16zVOpFfGvLv5H57xzwDgs1h7Wb5Jr7X+fkfiT8oyvpTQRuwBX0t8Y0+B8E8o8IO5u8/8suYc+xr5qUkn2r/ADv4kyaGAxUsLCtGpbrF3/4Y/jzOssWDruiqkZ+cdhwAFJsFOorwG77nl2Qm0dKTYtOopBYbsFKVBpaKB2G7BS7QKWigVkN2Cmk/wipK2fD50T+00HiHf9lz8xj+9XRhaKqTVNyUb9XokaUaKnNQva/V7Gdp+m3uq3K2enRNLK5AAUZ6194fBL9nRtIli8S+NEHmjDRwNzg9i1ehfBa3+DAtlk8FMj3eOTNgzD8DX0aMV/c3g/4JZXhlDM69WNefS3wx/wA362P6h8O/DLA0IrHVZxqz6WfuoRUVAFUYA6U6iiv6iSP3QKKKKAP/1/14pMgUtNK7jwa/xwSP857N/CBwy9MitTTtIv8AU5glquRWv4b8OT6vKJJRsjU817NZ2FtYwi3tlCgd/Wv37ww8FK2bwjjsc3Ci9l1l/kvU/sTwC+itieI4RzXOG6WG6JaSnbt2XqcVp/ge2iXzNRbJ64Fcvrfxa+EXga4Nre3kfmKcERL5hBHrtJqt8cIPiLqmkW3h/wAAxkfa5NlxMpwY09c1V8D/ALPXgXwzp6HVbcX98wzLNLyS3ev6yybgvAZf+6wNCMbfaau383ds/wBXPD/wb4L4dwcKtOguZ7KKTlbvKUk9+i3O48EfFPwT8QTJF4TuvOaLllKFDj1we1ei9DngVymg+BfCvhm8mv8AQbNLaSbAcqOoGeK6xsYy1fZU+ZRvLfyPo8wlh3Wbwaag9rtX/BHJyeNvDUXiWPwg9yP7QkXcIsc4FamvavbaDpFxrN2jPHbJvZVGSR7Cvkv4S28eufHzxHrOpnfcWq/u88leccenFfZLxxzIY5gGU8FSMg/hUUKkqkG9j2uJMqw2BxUaOsklG9+raT0fbofLtr+018M9TmFnrVvLaK5wDJGSP0FejTaHo/iLThrnhGdZ4XGRtII/TpXWa34B8F+I7F9O1DT7eSNsg7UUEfiBn9a8P8A/C3xh8MfiE1voUxn8O3QZmVj/AKs9hj9K+J4n4HwWa0/ZY6kpJ/aStJedz4PxL8HeDuL8tqUcXQVKqk7PS/8A27Ja38ne/YtSwzQOYp1KsOoNRBgeBX0BquhWGqRssigNzhh1/GvE9W0qfSbs20w6dD6iv4x8R/CbGZC/bc3tKT+0unr/AFqf40+OH0dcz4PmsSpe1w0nZTS2fRSXR/gzMpmcfI1Por8kufzofWf7KHi46V4kuPD13IEhul3Lk4G8dOvtX6F/2lpn/PZP++hX4hxXM9pMJraRo3HQocGtMeIdcP8Ay+z/APfxv8a/pDw8+kFUyTLYZdOhz8t7O9tH8uh+wcIeLk8rwUcHKlz8r01P2p/tLTP+eyf99D/Gj+0tM/57J/30P8a/Fj+39c/5/bj/AL+N/jR/b+uf8/tx/wB/G/xr7j/ia3/qFX/gX/2p9V/xH7/qG/8AJv8AgH7T/wBpaZ/z2T/vof40f2lpn/PZP++h/jX4sf2/rn/P7cf9/G/xo/t/XP8An9uP+/jf40f8TW/9Qq/8C/8AtQ/4j9/1Df8Ak3/AP2n/ALS0z/nsn/fQ/wAaP7S0z/nsn/fQ/wAa/Fj+39c/5/bj/v43+NH9v65/z+3H/fxv8aP+Jrf+oVf+Bf8A2of8R+/6hv8Ayb/gH7T/ANpaZ/z2T/vof40f2lpn/PZP++h/jX4sf2/rn/P7cf8Afxv8aP7f1z/n9uP+/jf40f8AE1v/AFCr/wAC/wDtQ/4j9/1Df+Tf8A/af+0tM/57J/30P8aP7S0z/nsn/fQ/xr8WP7f1z/n9uP8Av43+NH9v65/z+3H/AH8b/Gj/AImt/wCoVf8AgX/2of8AEfv+ob/yb/gH7T/2lpn/AD2T/vof40f2lpn/AD2T/vof41+LH9v65/z+3H/fxv8AGj+39c/5/bj/AL+N/jR/xNb/ANQq/wDAv/tQ/wCI/f8AUN/5N/wD9p/7S0z/AJ7J/wB9D/Gj+0tM/wCeyf8AfQ/xr8WP7f1z/n9uP+/jf40f2/rn/P7cf9/G/wAaP+Jrf+oVf+Bf/ah/xH7/AKhv/Jv+AftP/aWmf89k/wC+h/jR/aWmf89k/wC+h/jX4sf2/rn/AD+3H/fxv8aP7f1z/n9uP+/jf40f8TW/9Qq/8C/+1D/iP3/UN/5N/wAA/af+0tM/57J/30P8aP7S0z/nsn/fQ/xr8WP7f1z/AJ/bj/v43+NH9v65/wA/tx/38b/Gj/ia3/qFX/gX/wBqH/Efv+ob/wAm/wCAftP/AGlpn/PZP++h/jR/aWmf89k/76H+Nfix/b+uf8/tx/38b/Gj+39c/wCf24/7+N/jR/xNb/1Cr/wL/wC1D/iP3/UN/wCTf8A/af8AtLTP+eyf99D/ABo/tLTP+eyf99D/ABr8WP7f1z/n9uP+/jf40f2/rn/P7cf9/G/xo/4mt/6hV/4F/wDah/xH7/qG/wDJv+AftP8A2lpn/PZP++h/jR/aWmf89k/76H+Nfix/b+uf8/tx/wB/G/xo/t/XP+f24/7+N/jR/wATW/8AUKv/AAL/AO1D/iP3/UN/5N/wD9p/7S0z/nsn/fQ/xo/tLTP+eyf99D/GvxY/t/XP+f24/wC/jf40f2/rn/P7cf8Afxv8aP8Aia3/AKhV/wCBf/ah/wAR+/6hv/Jv+AftP/aWmf8APZP++h/jR/aWmf8APZP++h/jX4sf2/rn/P7cf9/G/wAaP7f1z/n9uP8Av43+NH/E1v8A1Cr/AMC/+1D/AIj9/wBQ3/k3/AP2n/tLTP8Ansn/AH0P8aP7S0z/AJ7J/wB9D/GvxY/t/XP+f24/7+N/jR/b+uf8/tx/38b/ABo/4mt/6hV/4F/9qH/Efv8AqG/8m/4B+0/9paZ/z2T/AL6H+NH9paZ/z2T/AL6H+Nfix/b+uf8AP7cf9/G/xo/t/XP+f24/7+N/jR/xNb/1Cr/wL/7UP+I/f9Q3/k3/AAD9p/7S0z/nsn/fQ/xo/tLTP+eyf99D/GvxY/t/XP8An9uP+/jf40f2/rn/AD+3H/fxv8aP+Jrf+oVf+Bf/AGof8R+/6hv/ACb/AIB+0/8AaWmf89k/76H+NH9paZ/z2T/vof41+LH9v65/z+3H/fxv8aP7f1z/AJ/bj/v43+NH/E1v/UKv/Av/ALUP+I/f9Q3/AJN/wD9p/wC0tM/57J/30P8AGj+0tM/57J/30P8AGvxY/t/XP+f24/7+N/jR/b+uf8/tx/38b/Gj/ia3/qFX/gX/ANqH/Efv+ob/AMm/4B+0/wDaWmf89k/76H+NH9paZ/z2T/vof41+LH9v65/z+3H/AH8b/Gj+39c/5/bj/v43+NH/ABNb/wBQq/8AAv8A7UP+I/f9Q3/k3/AP2n/tLTP+eyf99D/Gj+0tM/57J/30P8a/Fj+39c/5/bj/AL+N/jR/b+uf8/tx/wB/G/xo/wCJrf8AqFX/AIF/9qH/ABH7/qG/8m/4B+0/9paZ/wA9k/76H+NH9paZ/wA9k/76H+Nfix/b+uf8/tx/38b/ABo/t/XP+f24/wC/jf40f8TW/wDUKv8AwL/7UP8AiP3/AFDf+Tf8A/af+0tM/wCeyf8AfQ/xo/tLTP8Ansn/AH0P8a/Fj+39c/5/bj/v43+NH9v65/z+3H/fxv8AGj/ia3/qFX/gX/2of8R+/wCob/yb/gH7T/2lpn/PZP8Avof40f2lpn/PZP8Avof41+LH9v65/wA/tx/38b/Gj+39c/5/bj/v43+NH/E1v/UKv/Av/tQ/4j9/1Df+Tf8AAP2n/tLTP+eyf99D/Gj+0tM/57J/30P8a/Fj+39c/wCf24/7+N/jR/b+uf8AP7cf9/G/xo/4mt/6hV/4F/8Aah/xH7/qG/8AJv8AgH7T/wBpaZ/z2T/vof40f2lpn/PZP++h/jX4sf2/rn/P7cf9/G/xo/t/XP8An9uP+/jf40f8TW/9Qq/8C/8AtQ/4j9/1Df8Ak3/AP2n/ALS0z/nsn/fQ/wAaP7S0z/nsn/fQ/wAa/Fj+39c/5/bj/v43+NH9v65/z+3H/fxv8aP+Jrf+oVf+Bf8A2of8R+/6hv8Ayb/gH7T/ANpaZ/z2T/vof40f2lpn/PZP++h/jX4sf2/rn/P7cf8Afxv8aP7f1z/n9uP+/jf40f8AE1v/AFCr/wAC/wDtQ/4j9/1Df+Tf8A/af+0tM/57J/30P8aUX1jIcRyof+BD/GvxX/t/XP8An9uP+/jf40n/AAkWvKcLe3H/AH8b/Gj/AImsfTCf+Tf/AGof8R/S3w3/AJN/wD9r1ljc4Qg/Sn5Br8U08W+J4mDDULkY/wCmjf4122kfG74k6LgWWqSYHZvm/nmvSwP0rMG5cuJwzivJ3/BpfmduG8e8M3++otLyf/DH67ZFFfnh4Y/a08T2DLF4itUu4+MuOG/wr6U8IftF/DrxW6QPP9infjbLxz9QMV+ucNeNfD+ZNQhX5JPpL3fu6P7z9ByXxNyjG2iqijJ9Hoe90VBBcQ3SCa2dZEboykEH8RU9fq0JqS5o7H30ZJ6oKM460VXurmGzt3urhgscalmJ6ACirUjCLlN2SFVqRjFylscz408b6F4E0OTW9ak2ooO1e7t6CvzF+J3xo8T/ABE1Ft8zW9gDiOFDgY9W96n+NPxNvPiV4sk+zMfsNsSkKDODj+Ij1NeMyQzRjc4wv0r/ADx8YfFvGZ5iZYXBNrDRelr+9bq7dPI/kDxE8QcRmdaVHDNxoxdtNL2/QiJydwFA45PFGR25FSCKXb5gQ7fWvwNXk3bX+vQ/JoQu7pXfkv8AITcKWo25G4dqlFtcsnmKrFPXBx+dOnSlJ6JlJSekVcSimqMU6oaadmCYUE460VH90YoSFKVtR+4Um8UqxzEbwpK+1I25s7eKbjZXf5DfNa9g3Cg5Ip7RzBAxQkH+LHFMKMTtUkkVo6TTtZ/18ymrXW/4f18i7p2pX+lXK3emyvDKhBDKSDkV95/BH9otNZMPhfxo+254WOc8bz6N718BvDND/rEZSf7wIpkUkkUouIWKspyCPUelfe8DeIGY8PYtVMLJ8v2oPZr/AD8z6jhbi7GZRXjVov3eseh+5OQeR0PSivmr9nL4pHxt4fOh6pJ/p1koHJ5dB3/CvpWv9LeFuI8Pm2Bp4/Cv3ZL7n1XyP7YyPOaWPwsMXQfuyX3eQUUUV9Aeuf/Q/XTJAya2tD0uTV71Ik4GeT7Vi7S4CivbfBmmC2077Sw+aT+Vf5geEfBizrNo0qy/dx1l6L/M/mT6N/hdHiniSGHxK/cU/fn522V/N2+VzqLO0isYBBCuFWvM/iV8U7L4dXmlWVzAZm1OXy1I42gYyf1r1fG0ivk/9quzkg0bSfEyLuGnXIycdN2P8K/0Jr2oUVGkrJW+SP8AdfgXJ8LLFU8FKPuWaSWiTSdkvI+r4XE0KSjgMAw/HmvN/ivpnirUfCM//CG3X2W8i/eA/wB4LyVzXZ+HtQt9T0Kzv7Vg6SxKQR06DNch8XNdl8OfDrVdXhJVooSAR/tfL/Wt67/dt+RlkdOosxpwglfmSs9Vva1j5h8M/tJfEHVrEaVZaAb6+gYRSSKxwT0zgd6+1NMnu7rToZ76LypXUF0/un0rwz9mzw1b6N8M7W7ZQ016TM7Hqd2COfbNe76jqEGlWEuo3RIigQu2OeB14rDCQlGHNUlc9vi/G4WrjZYfA0VFKTWl7y6a30PkG5B8A/tMJOfkt9djyccD0A/MV9jsuUIB+8MZFfnH47+LEfin4i6d43TT510nSzsaXafm565xx9K/Qfw9rdj4j0iDWtOyYbhQy54PPOCKjLqsZc8V3PU47wNalHDV6qXNypOzvqtj4f13xJ8UPhn8Urvwr4ZnOrnUf30cL/Mybs469MV9ieAbrxXe+G4Z/GcaxX7ffVe3196+arsppn7WEb3/ACLizAjJ9WzgD6V9lfSpy+naUnfqzPjnGxdOhTUI3cIyckknLQp3d9aWe1ryVYw5wCxAyfbNYfibQxrNl+6x5icqfUelcl8WfhxF8SvDo01Z2tri3bzYJFPRwOM15l8BfiBrlxf3nw08ZEtqOmZCO3V0HH6VxZ/leHzCjPAYyN4TVv680fnPFfhtgOIuH6+HxD542tOPWKe0k+v6E88MkEpilG1k6imDpXd+PtNSC7jvYxjzDhvwrgx0Ff5u8Y8OzyrMquAm78r0fddPnbc/wD8SuCqvD2e4jKKv/Lt6Puns/ut8wwD1o2gHIpaK+ZZ8Ogoooqudjuwoooo52F2FFFFHOwuwoooo52F2FFFFHOwuwoooo52F2FFFFHOwuwoooo52F2FFFFHOwuwoooo52F2FFNLYqSGOW4kEMClnY4AHUmrgpSfLHcItt2Q2iu+1D4V/EnSdPbVdS0O9gtkG4yvEwUDrknGMVwsEU1zMlvbqXeRgqqOpJ4AFdeMy7FYeShXpyi3smmm/wOrEYOvRkoVYtN7XVrkdFdbr3gHxt4WtEv8AxFpV1ZQSHask0bIpJ5wCa5m0tbq/uks7KJpZZG2qqjJJPYCpxGBxFKp7GrBqWmjWuu2nmTWw1anP2c4tS7WdyCius1/wJ408K20d74k0u5sYpThXnjZAT14JFVNB8J+JfFFx9l8O2M17J/dhQufyFbPKcYq31d03z9rO/wBxp9QxHtPZcj5u1nf7jnqK9A1z4U/Ejw1bG913Rbu2hAyZHiYKPqSK89J5xiox+W4rCz5MTTcXvqrEYvB1qD5a0XF+eg6itbRNB1vxJqC6VoFpLeXDAkRxKWY45PA5pdb8P694avTpviCzls7gAExzKUbB74NZvBYhUvb8j5L2vZ2v67Eexqez9rZ8t7X6XMiium8O+C/F3i5JX8MabcX/AJGPM8hC+3PTOOn41LpHgTxpr97Ppui6Xc3Vxbf62OKMsyf7wHT8a6aWTY2oouFKT5ttHrbe3c3pZfiZ8rhBvm20ett7HKUV6f8A8KV+Lnfw5qH/AH4f/CuZ1jwP4y8PX9vpeuaZcWtzdf6qOVCrP/ug9a6MTw5mVGPPVoSitFrFrfboa18nxlOPNUpSS80/8jlqK7TXPhx4+8NWB1TX9HurO3BA8yWJkXJ6ckVxQJIzXnYzBYjDz9nXg4y7NWZy4jDVqMuSrFxfnoLRXe2/wt+I13pw1i30S8e1K7xMsTFCo5znHSuCAkLbApyeMVri8sxdDl9vTceba6av6XKr4OvSt7SDV9rp6hRXpWmfB34o6zaC+0zQb2aEjIdYWII9jjmuK1nQta8PXbWOuWslpMvVJVKt+RrbF5JjsPTVWvSlGL6tNL8jWvlmKpRU6sGk+rTMqiut8O+A/Gvi21e88NaVc30UZ2s0MbOFJ9SK27n4O/FWziM9z4ev0RRks0DgfyrWjw7mVSn7anQk473UXb8i6WU4ypBVIUpOL62Z5vRVoWN616mnCJvPdtgjx827OMY9c16IPgt8WmAZfDl+QeQRA/8AhWOCyTHYm/1elKVtHZN2fnYyoZdiat/ZQbtvZNnmNFdRr3gnxh4XAbxHplxYqeAZo2QE/iK5Yk5woyfauTF4OvQk4V4uLXRqz/Ewr0KtKXJVi0+z0YtFd5pfwt+JGt6cmr6Tod7c20o3JLHEzIw6cEcVw9xBPaztbXCFJEJVlbggg4IPuK2xmWYvDxjKvTlFS2umr+l9zSvg69KKnVi0ntdNXI6KkghluZBDApdycBRyTXplt8Ffixd2n2+38P3zRYzkQvyPXpV4HJ8Zik3hqUpJdk3+RrhMsxOIu6EHL0Vzy+ird/p9/pV29jqcL28sZwyyAgj8DXRt4A8apoR8TvpdyNOC7jc+W3lAZxnd0rKll+Jm5KEG3HV6bLz7fMwp4arPm5YvTfyt3ORoqaC2nuphb26F3Y4CqMkn0r0mP4K/FiWy/tCLw/fNERkMIX5HqOK3wOS43EpvD0pSS7Js2wuW4mum6MHK3ZXPMKKs31leaZdPZajE0EyfeRxtYH0INdLa+AfG19oZ8S2mlXUlgASZ1jYx4HX5gMcVz0suxNWcqcINuOrSWy8+xjSwlabcYRba38rdzkMDpQVB4qWGGWeVYIgWdjgKOpPpXT654E8Z+GbeK88QaXc2cU5xG80ZQMcZwCcZqaWXYipTdWEG4rdpaL17ChhqsoOcYtpbs5PGOlIWZfmU4PtXpdv8HfirdQpc23h6/eOQBlYQMQQehHFFz8HPiraQNcXXh6+jjQEszQsAAPwr1nwnmsYc7w87d+V2/I7XkeOinL2Mrej/AMjY+HHxt8W/D6dY4pjc2YPzQOcgj2OeK/Rj4cfFfwx8SLATaVIEuAPnhY/Mp/qK/INl8tivcHFbvhzxFq/hbVo9Z0aVoZojkYPBx2Nfpvhp41ZjkdSOHxEuejfVPVpf3X0t22Z9vwV4mY3LKipVZc9Ls+nmn+h+11fN37TfjKTw14CbTLR9s2oN5fvs/irt/hD8TbL4k+GVvxhLuLCzx5/i9R7Gvlf9sHUJJte0zTc/LEjvj/ex/hX9W+LnGcJcI1MdgJ3VRJJ/4nZ/dsfvfH/EsHw/PFYV/HZL5tHLfsf6RpOufG/T7DWreO6geKcski7lJCZGQa+xm+JPw0v/AIyT/BvU/Btl5Bk8pbhEG7kZzgLx+dfJf7E+0fHzTi2ABDcH/wAh19JfE39pL4b/AA1+Juox6d4Ohl1qBsG+3AEsRweRX4V4eZnhsFw3QxOJrKnH2r5k4c3MrRvHZ2Py/g/H0cJktKtWqqCc2ndX5lbbZnyd+0B8KdN8F/GqXwb4YUtBctG0UY5K+ZyQPpX6WJ8JfhbH4JHwhaztv7aOmk+bsXzMlfvZxnIr4m+AMmsfHf8AaGPj3xWAUsx9pfj5AqfdX9a+sG+IfwHHx0XxW2tz/wBrgfYREP8AU4PGP1619B4c4XL6cK+PkoQp4mrKMVJpWp635fO9rW2PU4Rw+DjCrjGoxjXm4pSsrR1289Ufmr8K/h/p2u/GO18DeJyYYBcNHKG4zsPA/Gv0F+I/i7wl8IvFqeDJvAsMnh8BVa98sNuBHJGAc475rxH4z/BiW5/acgsdLvl0ldbH2uC5/hRwOAOnJIr2vQdc/aS8LeOYvAPijSk8Q6SSEe8MRIKHqS/IGBXncE5NWy2nXy9UnGfteVVIwUr9lJbqLTvdHPwtl1XBqrg1TcX7RrnSUn6OPSL7n55/G8fD2XxzNefDRiNPlUN5ZBGx/wCIAelcr4P+HHjX4gTtB4R0+W9KcN5Yztz617/+2P4U8IeE/icY/CaRwmeNZJoo8bVY9Tj3rS/Za8TfGfw7HeSfDfTItQtWYfaFcfMPoe1fkMeG6Fbiergccm480r+yV/uWyXfsfnEcmpVM7nhMVe13fkV/uXTzMhf2S/F2laNca34w1C001IImk8t5AZCVBIGPfGK+VrOKF72KO6bbGzgO390Z5P4V+rfjDwnZ+PdD1DVfHXg+40u9jgkcT28pYFlUkErjpkc1+TjqFYjsDR4mcNYXK69COGp8sGm9ebmdn9q9rdtB8d5NQwFSl9XhaLT35rvXrzJf5H63eB/AnwPj+C2vx+DFi1ae1tmaS7kQMQ5U8KT0xX5u/DD4c6l8TvHtv4U0xSBJJ+8YdFjByxP0Ffav7LIH/Cg/GO0/8sm/9BNSfss33wv8N+BNWv8AUNbtNM1u/LwLJM4DRp2IBOc5NfqePynCZxVyueJUKUfZym18KfLJ+6r99N9T7rFZfh8wqYGVZRhDkba0SdpPRPztqesfGXwl8LNN/Z61618H2Fu8ukJFbm6WNS5fcu47uufWvnP9lz4b+DbbwVrHxl8d2y3dvpoPlROMqcZySPrxX1Pp/wAO/BkP7PuueH08SwXljfSebNf5BRW3BuTnqTx1ryD4CWVh4w+A/i/4S+H7hJ7uJpFiIOPMUkkMvtX12c5bCpndDFOEOd0JOEVytc65uW1t9Nn1sfR5jl6eaUa84x5vZS5UrW5le1l1338jR8E6l8NP2p/DmteHT4ft9J1GxQyW8kIAPQ7TkAenSvzC1WyfTL6fT5OWgleMn12kj+lfpV+yR8P/ABP8LB4g8Z+O7WTTLWCEovnqUL4ByQD296/OLxNfxap4hv8AUI/uTXEjjHoWJH6V+K+KUak8swOKx8OXESU+bSzcU/duklr+h+Zcdc08Fha2KXLWkpX0s7XVm0dl8IfF0vg7x3Y6nG22NnCSD1VuP/r1+vUUiSxiSM5VhkGvw9hka3mWaPhlIYfga/ZX4eXj6h4F0i9k+9LaRMfqVGa/ZvosZ5UnRxOXzd1FqS+eh+keBGaTlSrYSWys1+R2NFFFf10f0Gf/0f19sovOuo1H8RxX0dZRCG2SJRgAAV88aWQl7DI3QNXrfjbSvEWt+FJrHwpdizvHUGORhkAgg81/F30Z6dNYfFVbe9eP3W/zPZ/Z/ZZQnSxs5yUZSlFNvorXv99zqZ9S0+2uUs7ieOOWb7iMwDN/ug8mvNfjZHoEnw11JPEbYh8s7T38z+DHvXyn4D03xLefH2HSPijema802ISW5U4RmP3QPqDmvtrxh4P0PxzoraDr8ZltmcOQCVOV5HI5r+mqc5V6Ulbc/wBQMXltHKMwoe+5JKMm1166Hxd8Hdc+PjaJp9p4esVn0mF9okmYIxjz6EgnGc8V9O/GzTrzWPhLq1mq5meAHA55BBP6CvSrG20/QtNjs4AsFvbqFUZwoAryvxX8bPhXpcM2l6tqcTNIrI6KCxwRg9iKn2Ko03Cct+52/wBp4rM8yhi8Jh9Iyv7q8+r7kH7Perw6v8K9NaIjMC+SwHUFOK9skijljMMqhlYYIPQivzc+E/xn0n4Ya3qulwxT3mjzuZLYRLll5OBg4HOea9avPj/4+8Zt/Zvw10GUO/HmzDG33wflNRRzKHIla/odWfcBYuWOnWhaNOWvM2la+ve90fVV3Y+F9OsTBfRW0FueocIq8/XiqVv4t8D2sa2ttqVkiIMKomQAD0HNfMmmfs9+NPGD/wBp/FDXJsy/MYIidvPYjOB+Fda/7KHwxMHlhJVfH3i56+uM1tCrWeqgl6nlzwOT0/3dbFSm+vLFcv4tHpHiC/8AhINTg8Xa1dWb3VkD5colUuoPoFPNeO+Iv2h7zxDq0Xhv4R2rX8zuA1wykRgZ5+n1Nbtj+yp8M4JfMvkkucdi5H4cGurs9Y+HPwz8XWfw702y+y3F7HvSVVGO4wW654rKp7a/vtJHXQqZarrCwlXnFO3NZKKXkt/vPZLI3RtITfjbMUXzAOm7HOPxr4+QK/7VsjaVnAtl83bjGABn/wCvX2WAeM15Z4a+Fek+GfGeoeN0mee5v8jDgfID1APpXViKTbjy9D53Is4pYWlifaL3pwsl0u2dN4x01r/SmeMcxc/h3rw/nvX0zKiyROjfdI5r5rnULO6joGP86/jn6SmQ0qOPo4+G9RNP/t1r/M/yQ+nTwhQwma4XNqW9aLUvNwtr9zIqKQDFLX8zH8IJ3CiiigYUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAzHJNfRH7LfgNvHnxf0y0dd0Fq4uJQRkFEIJBr53JOcjtX6wfsE+A10vwvqXxAvAFN03lRMR90Lncfx4r9Y8GeGv7Sz6jCS9yF5P5a6/kfd+G+SLHZtTjJaQ95+i/qx9fa3qPhv4iDXfhTA4aWC1CSj+75gKj8q/AjX9LvvBni6503aYpdOuCBnr8jfKf0zX7L/Dn4SeIfCXxm1L4i3utW1xBqpYPAr5bp8gAx2NfC37b/AIB/4RT4n/8ACR2ybYdWj8wnHG8fLj8hmv2zxyyzF4rKqWcVoctSlNxdmn7rd4vT0P0zxTwGIxOBhmNSHLOnJrRp+7f3XofYHi1Yvjv+yempWoE13Bbq6nGT5sQCsf518G/sk+BJPGHxnsop1/daaTcuSOMx9Aa+nf2C/Giano2rfDTUXyCpliU/3SCH/U5r2P4BfC63+EF14v8AFWoL5cKzyLCzDGI0JOR7HNenhMhp8QYvLOIZfDGP7z1p66ndhcphm9fA5y3oo+//ANuHzh+2p4lfxx8TdH+F+myArCyKfQSyNswf0r6F8W+I/CP7H/wssbXQrGOfVLhQMsBueUrlmY9cZz0r83YfG/8Awknx+t/GOpkFZdUjck9AokAz+Qr7a/b/AND1DVNF0bxTp6tLaLwSoyBuG4E185lXElSrgM24iwf8fmiovdxh3Wj6Hj5fnU6uGzHOcMk6vMkn1UfL/Owvwg/bMtfiFrL+EfizZWttb3CkLIPuAns28/rXxL+0Z4e8G+HfiXcJ4FuI59OuFEyeWQVQtn5Rgnpj9a4P4ffDnxN8SteXw/4YhMtww3HPQD1Jp3xI+G3iD4W6/wD8I54pCC52CTCnOAen8q/J+J+Kc5zTJIPMqPPCM9Kr3/w76nwWdZ9mWOyyEsbT5knpUa19Gz3r9inP/C99PUf3Jf8A0Bq6H9uHTdUu/jNLJawvIv2eMZVSR0HtWB+xUMfHjTSP+ecv/oDV9t/Hn9pXwz8LvHT+GtU0OO/lEav5rKpOCAcZIr9H4fyrAYrgNUsxrulD2r96zettFa/mfZZRg8NW4WVPGVfZx9pva/TY8w/4J+WF7Z2Pib7ZE8WRDgupH8LdM1ufsm4/4Xb46KnkFf8A0I17f+zp8btB+Mdnq76NpSaZ9iChtgA37geuPTFeI/sm/L8bvHOR0K/+hGv1PIcDhaE8lp4Op7SCdS0rWvo+nkz7zKcPQpf2ZDDT543naWqOW+Jv7Xnxf8I+N9Q8OaVpcM1vaybUcpJkj14OK+dNU+Mni74wfFzw5f8Ai62S0ltJRGioGGQxByQ1fWHxE/a78H+EPGN94du/DcNxJavtMhRSW+pIr5H1j4l6Z8U/jponiHSrBbCLzY08tQADjvgV+XcVZwqmNp0IZlKs/axvTaaS97vfpsfBcQY5SxMKccbKp+8XutNJarrfWx+vnxd8F2PxD+HeoeEpivnT25MOcZDqMhgPavwp8C/DzUfEvxJtvAxjYyNc+XIO4UNhj+XNfsB8X/iKfAHxa8GJcPttdQWa3lzwPn2AMfpUekfBfRPAfxX1r4yTFRbSW/nRcfccj5z+VfqHH/B+G4hzWliVp9Xly1f8KSmmffcXcOUc3x8KysnRlaf+Gykey67penaH8M73QLEqFsrFosLjjbH3+vWvzA/Yr+DujeN/EN74y8SRCe10kgpG3Kl2yQfwxX2X8LPGdx8QPhl4s8TzNuWd5wn+4qsF/SvIf2C9Qs7zwZ4h0JCBcK4OM8kMH/lXRmv1LMuIssxEoJx5JyirdVt+RpmX1fH5vgako+64zaXmtjm/iT+3Nq/hbxhP4d8B6bbvYWUnllpMjdjrtC4GPrXqniiw8G/tV/A6bxhZ2iW2qWsbvlQNySoMlcjqCP51+UnxA8O6p4X8X6jourRss0M7g5B55r9Rv2SNJvPBv7POs61ro8iK6Ms6Bxj5BGBn9K/N+BeKs0zrHYzAZv71Hkk2mtItXtbsfEcKZ/j80xeJweYvmp8sm01pG21tNCj+wj52n/DvxFJgCS3nHB7FUPH6VzXgX9s/xnrnxSg8D6/ptvJZ3NybfMe4uMnAOCSK7b9iK9s7rwj4o1EjMD3hcj/ZIY/yr0z4PN+z94t8T3974G0+JdU09yzlx82455XNfpHDeCxNTLsqpYTGeySTbjvzpPZfI+1yWjXqYPAQw2IVPTVfzJdu585ftY/D/wAP+HPir4T8V6NGsEupXkaSoowCVYHdj15r6A/aW+OHiX4J+FtI1Lw3DBO10wRhKDwAmeMEV8QfHL4jeJfGf7Q+n6NrkBtYtLvoooovX5x82fcV+hHxx1r4Q6NoWkL8Wrf7RFKyrCOwYr1P4V4+T4+GIp5xVy+r9X9+NptWSezffV9LHnZZi6daGY1MFU9iuZWk9EtLX+Zxvws8caf+1D8J9SPjbTIo5Ig0blV4yQSCpPIxj1r8grfwpNe+Oh4P0475HuvIT6lsCv2P+MHia0+EfwOfWfhRp8f2W6QANGMBEkH+sPr+NfB37FvgiTxp8Xf+Ei1AGSHTg07Mef3h5Q/mDXy/iJkX9oZzluTyfPWsuedrKSve/wAkmeDxjlqxmY4HLaj56iXvztun5n6kaFqvhr4a2/hz4YhhHLdQska+hjTe2fqc1+PP7VfgI+AvjDqFvHHttr4/aYj0B3csR/wImv0o+KXwi8SeNPizpfj7S9bt7WHStgELNyQGy35jivLf29PAg1jwlp3jy0UPJYny5WXp5bZOc/71fU+L2Q4jMcjrqdPl+ryThZp3p2UW9H6s+h8RMsq43LarlC3sZLl842SfX5nA/sX/AAq8NQeHLv4xeLYVnWAstuHAKqU+8SD39Kqa3+35r1t4pe10DSYDpMcmwBshyoOCRg7RXrn7MpTxR+yzf+H9MI+0r9oQoOuW6fnXwL8IPEPgT4f+NrxPilpct8g3IsIUFg2SOhxXx+ZZni8rwGV4TKqyoUqkbyna6cnveyv8j5rGY+vgMHgMPgKvsqc1dyte789/uPpD9p3xj8D/AIr+A4PFfh2aOHXogrGJUKs24gMrHGMrknNe1ajgfsL3BJx/oR/9DFV/jF4J+Erfs83nxC0nQxp0k0atEsigSKWcLyPerN/kfsMTkf8APkf/AEMV9ZLLq1LGZjVxTi5TwzbcU433s2u7R9HLB1aWJxsq7i5SoN3irX82n10PPP2O/hb4Y0bwVefGfxZAsrRbxD5gyEEY5YD3rD1P/goB4jt/FDxadpNv/ZMb7QGJ8woDjPB217F8EFHjP9ke/wDD+i83JhuIiB13Yr87PBfwG8bePbbUJ9ARDNppYSwMcSYHcD3r5TiDMM2y3A5dguHLqMocz5V8TT1u+vpe7Pms4xeZYLC4PD5LopR5nb7Uuqfc+8f2mfh/4Q+K3wgg+NPhSBIrqOMSnYoBdTwVOBjIPOa3fhbuP7FNxu/55XI/8frV+wz/AA2/Y2/srxQPKuI7ZwyP1BdzgfrWd8Ho5dU/YuuILIGSQx3I2rych6+6ng6SzavVUeWrUwjlOK7t9l1PrpYaEcwq1EuWc8O3JL+a2vzPym8JhT4tsc/891/nX6e/tzbh4D8LLxt87/2mtfmd4MsLu58aWNnDEzSm4UbQOevpX6Xft1OkPgrwtbyHDmcDb3+4K/FuAKUocJ5m5qy5ofmj814SpuHD+Ncla7h+aPavil8S/Enws+Bui+IvC9stzcNBbptcMRjywf4ea+INa/bS+MepaNPp+oaNbrBKhVmKSDAI55r7t+IfxK0z4WfBbRPEOqWK38Rt7dRGwBGfLHPOa+IfiD+134O8X+D9R8N2nhyK2lvIWjWRVUbSe/Ar9X8V81jSrSgsylSfIv3ajo/d2v5n3nH2YxpVZL666b5F7ltHdd79T4HkcTStKP4mJP40tMPXI7mn1/EU5X1Z/MSd9Wey/Arx1c+CfHls7yEWl0RFKvYg/wBc16T+1vn/AITS1I5/cg/pXzBpRK6rbMOolT+dfSP7UkjS+I9Od+rWyn8wK/ZMuzirV4MxOEqPSFSLXle5+jYLMalThuvh5O6jONvK/wDwTwDwl4w8SeB9aj8ReF7lrS8jDKsigEgMMHqCOfpVPXvEGr+JtXm1zX5jcXVwcvIQMsenbiqdhpl/qlyLDTYWmlIyFQEk468Ctu58FeLLNDLcabcoo5LeW3+FfmeHo4+th1CkpSppt9Wr9en6nw1Oli6lFKCfIttG1fqangv4meOfh+lwng+/eyW6GJQqqdwxjuDXHG8uftpv2ZvPL79+ed3XNVZFeNtpJLDsetb58LeJDY/2sLOX7MBu8zYduPXPSs6M8bWpqEeaSp+r5fTt+A4zr1YqELtR+aV+vl8jpfFPxa+IXjJrVvEeqSXT2OPIJCqUx0wVANd5bftR/HW10v8Asq316ZUxgZClgOmMkV4TY2F5qFyLSxjaWWToqgkn8BU2qaPqmjSiLV4Ht3PQSKVJ/A16GHzfN6SliYVZq+jkm/xfodVPNsxipV4VJrm0bTa+97j9Z1nVPEWoSatrM73NzKcu8hySa3/C3xC8beCopIvDOoy2ay4LiMgZxWLpXh/WtaDf2TayXCp94opbH1xWZLBLbzNBOhR04YEcg15kXiqLWJV4366q/o1b/I5IyxNJqum03fXuep3Xx0+LF7bPZ3Ot3LxzKVZSRghhgjpXkueSOpzmpaZ82cGsMbmFbEtOvJya7tv87mOIxNWrrUk366ndeHPid458J6JdeHvDuoSWtnejE8ShcODxzkZrhGO87iM85obGcdM9K1ptA1mCxXV57WRLZ+kpU7T+PSt41MXXp21lGHrZJ+m2pLnWrQtq1Ffd/kdJZ/Erxvp/hCfwHa6g6aRc8yWwC7W5z1xnqPWqHhHxp4l8CasuteFLt7K4TgMncehB4NZOm6Jq+tF10m3e48sbm2KWwPfFUDb3DXBtVUmTO3ZjnPTGK3q4jHL2dVuWnwPXp0i7vr22Op4jExcKjbv9l63+X/A+49m8cftC/Fn4g6cdI8R6rJJbHhoxhQ2PXAFeJcFcZrqb3wX4ssLMale6dPFAw++yMB+eK5ZcAYA5p53Ux1Wvz49ylJreV7v7xZpVxc5c2Ncm3/Ne/wCI9v6V+xPwo/5Jvon/AF5xf+givx2Hb6V+xPwo/wCSb6J/15xf+giv6e+ip/veKX91fofungR/vNf0X5noNFFFf2uf0uf/0v13RtvzdNpFfQXh7UY9Q0uORSNyjDYr58xn5SODXR+Htfl0O45JaNuCK/zQ8GePYZHmLWIf7qas32d9H+h/P30YvGOlwlnb+u/7vVSjJ/ytO6lbtr0MD46/DTW9SvbX4jeBuNW07kqvWRR29yBxio/Bf7S/hi/gFj4zVtLv4RtkWQYUke/rX0bYarZ6lCJbZwcjle4r5j/ab8GW2qeG4ZtG0pZ7+adF82NPmVc85x61/dNHFQqU/rWDmpJ66ar8D/dDgbivK8+oUMLXmqkPs1IyWite1+qXmcPd6z46/aK8RS6V4fmbT/D1uxV5hkGTH869x8Nfs7/DLw9DGklkt7Ko+Zrj59x/Gu9+HXhSy8GeD7PRbNMeXGpf1LEZOfxrodb1zSfDmmy6rrM628EYyWb+nvXfh8PFL2lTV9TbNOJcTiaywmX3hSWkYx3fm2t2zJs/AXgqy4tNLto/91BXTQWtraqEto1jA7KMV+f3h39oPxXpfi/V5tOiuPEGmzysYAFOYxk4A44GK9Gm/azg0+3L6x4furZ+2/jP6VnSzGja9rHqY7w7zZ1eSMlO/mr/AHPW6Ppzxjrd14e8NXms2kYlkt4y4QnGcCuH+Gnxa0Hxz4Yg1e6mitrmTIeFm5BWvnuOz+MHx+nEl27aLob/AMPILqfUdTmu1i/ZG8AwxKq318r7eSsgAz64xRGtWnLnpx08wnk+T4XD/VsfVvVbv7i5rL+V7L7rn0zca1pFpam9ubmOOIfxFhivhj46eLtK8eeMNLtfhmHvtXspMiWHlMDkDI9DWZ8Vv2fbjwjY2c3hue9vxNKsbruLYBPt0r7I8BfDLwn4EslOhWixzSIu+RuXJxyCampGrXfs5JJI6cNUyzJoQx+Gk6k5XSTsku/Mrtvc8t+G/wAWviFq2v23hLxf4flt3IKvdchflHXHv9a+li6qPmIH1pCkYbzCACO56/nXyH8X/GGoeI/iRovw/wDBtyd6Sh7hozwvoCf510TqeyjZu7Z85QwCzbESnRgqUYpuVrtaevc+rtXuhZafLcd1UkCvnRmLsXPViT+de1eMLz7Fonln7zYX6+teKV/GP0kc49rmtPCxldQjt5ydz/HP6cfEf1jiKhl8Z3VKF7dnL/NJBRRRX85H8SBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAg271V+FJ5x1xX6GXn7UPw90D4CJ8NPA5uY9S+ziJpCmwByMOwbNfnlyCe9IOvSvq+HOMcblMK1PBtL2q5ZO13byfQ9zJeI8TgI1Y4Zpc6s9NbdbPod7o3xN8aaTq9vqi6jO5gkWTBckEqc4NfW37R/7Q3wu+Mvw+sbCwFwNWs9jZaPC7toDjd6dcV8GDk9KB0wRzWuXccZhhsFWy+M706u91f7r7FYTijGUMLVwkWnGpvfXbsey/AX4mJ8KPiNZeKrvcbVTtuAgyShByAPrX278cP2zfAXjD4dX/AIa8ELcLdXi+UTJGUAVuG5+lfl4A6/dPTtQA5IJOPavQyTxLzXL8sqZTh5JU579XqrOz6HZlfG+OwmCnl9B+5K99Ndd7MkUyRsJEbDdc+9fop8JP2xPDR8JR+A/jLZG9t4UEYlCeZuUdAyn0r866aAc9cV5XCXGmYZLWdbAy+JWaeqa80zjyDiTF5bUc8LLfdPVP1ufqnL+1R+zz8ONPnuPhfo4W+lU42xBASfVhX5vePfHOs/EbxTc+K9dfM1wxOOyrnhR9K4zDZ55oZQx9K7+L/EXMs6UaeJaUI7RS5Y376HVxBxhjcyjGFdpRi7qKVl/ke8/s4/EjQPhd8TbXxZ4m3/ZYFcHy13N8ykDj6mrn7S/xQ8N/Ff4it4p8LeZ9nMSJ+9XYcgDPFfPZ6cCmgEjnqa82pxdi3lSya6dJS50rK97d/wANtjhqcR4p4BZbdcl+bbW/qfaH7Jvx78E/Ba01uHxaJ91/5fl+Um/7oOc+nWtz4FftD+A/h38SvE3izXhcfZdXKmHYmW4JPIzx1r4VBI4AwaaFcYBbIr38q8Uc0wUMLSpNf7Pfl06y3v3tc9bA8d5hh4UIU2rUr8um1++up+our/H79jzW9Rl1bVtDkmnmO53a2ySa+bPiX8SPgrdfETw/4l+Gli9jYWBLXSrFsLHcMYHfAr5RPNNGV56+1dmdeLOZYyKhUp04tNSvGCTunfc1zDj7G4qPJUhBap3UUnda9D7Q/aq+PvhD4u3Gg3fglp0fTN5cyrswTtxj8q77x/8AtiaR4m+CqeDdOE0etzQLDMxXCYAw2G75Ffngctz0oxjp1rlq+Kebzq4qrz2ddJTslayVtNdNPmZ1OPMxdSvVjJL2qtLTytoujPvT4F/tH/D/AOHnwe1HwRr32j7bcq6rsj3L8ykDn8a+aPg58XvEHwc8XJ4k0X95G+RNE33ZEz+hryLLE4I/GjDdD0rzsX4gZlVlhpqdnQVoNWTS8+5xVeLsbN0HzWdFWi1oz9XZ/wBpX9lzxw6a5420YNfqAW3wBjn03d68N+Pf7W9r400A+BvhxbGx0wjazkbGKjjaFHQV8J428AUoDd69/OvGbOcdhpYaTUeb4nGKTfq9z2My8SMzxWHlh5csVLdxVm/Vn3R+zF+0R4A+EngnWPD/AIp88z3zbo/KTcPuEc88cmvDvhN8XpPhp8WP+E0tGc2ks7CZAOWiY8jHrivCAMYGOnekKk14U/EPM+XCpSt9X+C2n3u+p5D4vxrjh1dfufh0187n2r8efjF8JfiB480Xx94VW4jubWaM3QaLaGRDuz15br9asftT/tA+Bfi/4Z0rS/CfnmSzfc/mpsGAuOK+I8sM8UAY+UDArox/iVmWIp4mi3Fe3ac7RWrWl12OjG8a4vEQr0pJJVrOWnVH6CfB/wDah8EWHwluPhn8VY5rhNpjiKJvzG3QE54x2pf2f/j98Hvgx4c1e1xdS3l3K5jbyvvRj/Vg88dTX584ZPmU5NKQ2QTzXfhfFzN6MqNRSi5UouKbV3Z9318ux2UPEbMKcqc1bmhFxTaT0fn5HoOt/E7xprOr3eqjUrhRPI7AByAASccfSvs7RP2ovh/rnwDb4a/EU3MuomFoy6x71JBynzZ+lfngFwfQUEc7QOK8LJOPMxy+VaVKd/apxkn7yalvb9Ox4+VcU47B+0lTnfnTTvre/l0Poj4A/H7W/gnrkjxR/adNuTieE+g6MPcCvtSf9or9kvXrr/hJ9X0UG/8AvMWtwW3Dv71+UgDYxuoG7uc17nDfi1m2WYdYSnaUFqlNKVn5dj08l49zDA0FhqbUorbmSdvTqj67/aN/abn+LsEfhbw9CbTRoGBC9C+OmV7Aeleg3f7SXw+m/Zmm+EqeedTa2MX+r+TduB+9npivgLDdOgowc47VxLxPzZ4jEYiU7yrx5JXSej7a6JdDGHHWYqtWryknKrHllddOyPpH9nr9ofWfgnqbI6fatNusCaHPTH8S1926P+1h+zbp17J4s0+zktdQnH75khwz/X1r8gArfw8U7DDoa7+FfF/OcooLDUJJwj8PMlJr07HZw/4iZjl9JUKbTitrpO3o9z9O/wBrvxxpvxO+G1jr3gfV4XsQd81puAkPbkZ7eleF/s2ftRH4RWkvhLxLAbvSJmJ45aMn72BzkGvjrzZyDHuYL6ZOPypuGIx92s8y8Ucwq5v/AG5hvcqNWeuj76Po+23YzxnHmMqZj/alH3KlrPqn8nsmfrND+0T+yZol5/wlWk6OqX/LKy24DhvUntXxP8ev2gL/AONXimC9eL7Np9k2YYgcn3Y+5FfN+w4wefwpcFhhqniXxazbNMOsLU5YQvdqMUk2u9h57x/mGPpLD1LKO7SSV2u9j9Xm/a0/Z413wXp/hPxhZ3F4lrBEjI8G4b0QAkVwGt/GH9jm60i4g0zQWjuXQhG+zAYPavzgIYfdpGyCGr18f44ZviKbjXhTbta/Im9rbs7MV4n5lWjy1YweltYq9ieZled2j4QsSB7Z4plR9fmPanr8xAA5NfkHK5Ncq3Pz3WTOr8C6Jd+JPFljpdkpZ5JV6exzX0T+1rZ/ZfE2nOowhg2j6qBmvTP2ZfhRLo9t/wAJvrcW2aYYgRhyFP8AF9fT2qf9rvw0174esfEkS5Fo5jbHP+sx1/Kv6nXhriMFwDXxFWP7ybjNrsk/8rtn7ouC62G4Uq1Zr35OMmuyX/A1Z5L+xWin4+acCAwME/UZ/gNfZFt8cviLd/tBXHwxuNPiu9GMvln9zyFK5yX6V8cfsVukfx90xpOB5E//AKAa9x+NH7XPjzwV8QNV8K+HrOxVYH2LOYyZMEddwPWufgbiPDZZwxQxWIrSglVk2oq/NorxautH/SFwpm9LA5JSq1arglUekVe+i0d+h4v+0X8OdLtf2iT4U8Iwqi3rRMIk6BpACwr9KIv+ELSz/wCGdVVPNOlnsM7SuD+NfAv7J+m6l8SfjLP8R/F0huP7OVrhpW/56DoPbjOK94f9pf4IN8X/AO120l/7TWUWn23dxsJ2/lX03AeYZdhqNTMq8o01i6sklJf8u9mkl1u9/I9rhHFYKjTnjKrjTWIm7J/y7NK2i1fU+UP2evD9x4a/aVtdAvo9r2s8yFSOwBxkfSvqz9uTwHYeIfDcPjnRUDT6Y/kXAUD5UbnJH1pfEvgyDQf2vdE8WaeB9m1iJpmYdPM2nj/vkCux8P8AinSNb+Pvi74Q+KWD2OoiKdFY8F0VeB+ANVknD1CjlVbh7EtL2laUYvTRpc0Xfs0rfMrAZLRp4Cpk9dpc9SUU/O14s2v2SfAmmeBPhpD/AGiEGp6zG9zggZMQ+7+Wa/Jr4sgJ8R9Z2jA+1P0/pX6o+EvHtn4h/acuvC2kuo07Q9Mkt4wvQMNoYenGK/LH4rv/AMXL1oL/AM/T18X4xV8I8mwdDCW5KU5wT78qSb+ep814kVcO8sw9LDP3YSlFP/D1+Z658Of2U/Hvj3w/D4wlmgsdKlBYTSNg4BIJxj1FVvif8LvhX4C8M40jxENW1feAUiGEUd+/rX0R8BtK+O9p4G0/UfDfiCy/s2VSY7S6ZSqjcQQRkHnrT/2ldHn/AOFcnUvEOn6YuoeYAbiyIB6egYmssTwhl8MgliaGGcZ8ibc/eb/wtOy8royxPD2DhlTrUqLjK2rlrf0tLT7j4V+HF74NsPFVteeO4pJtOQ5kSPqfav0m/aA1vwz4h/ZRttZ8LWa2li7ReTHgAhQ4HNfk4AFGW57V+lXjh0H7DulICM/ujj/gdfN+Gua1HlGZYS0UlTbWmr1VrvqvLueNwRmE/wCzsZh2lZQve13e56N+yf4m+Fmo6JfeGfBOnul7DYGa7nlHLN0Kj2zzXjP7MngHQvEfxg8SeJ9ahSeLSJJnVGGR5m4kH8s1T/YLeGPxN4kckAf2cf8A0IVf/Zf8c6LoPxe8TeFdamWCPV3mRHY4G/cQBn3r9LyPN6OJpZNXxXKtaiXSN1dR9PmfbZRjqeIpZZUxSitZrpbTY9C+FP7SmpfFj4q3nw68S2dtJol4JI4E8sZQLwAT3zXwZ8cPB1r4D+Ker+GbEEQW837sHn5WAb9M191/CH9mzXfhb8W7rx74llhg0Wy82SGYyKd+7kHGcjHvXwv8dvF9p46+KuseJrBt0M8uIz7KAufxxXxXiQ8UshorOH/tCqStf4uT/K+x8txssV/ZNJZn/G55W78v9bHko5wBye1fsb8LojD8OtERuos4s/8AfIr8lPB+jXGveJLLSbddzSyqMe2cn9K/ZnS7GHS9Og0634SBAi/QdK/R/oqZXUSxWMe2kfnv/kfZ+A2Bn+/xT2dl+peooor+xT+iz//T/XimHk7WGRT6K/xvcU9Gf5zodb3U1s263dkYd67jRPF1+LlIL9w8fAye1cLSBQDkV9Rw5xhjsrrRq4So0k07Xdmu1j7rgbxHzjh/EwxGX15RUWm4ptRdujWzufTiSJIgZTkHpXlvxN+F1n8TYbS01K7lhgt5N7xp0cehqn4c8YSafELXUSXjHRh1FehReI9HmjDicDPY1/enC3ilk+bYVVJVVGVtYt2a/ryP9j/C36SmQZthIY2jio0a1vejJqMovyvo15oi0Lwp4d8N2Kado1nFBEgwMKMnHqep/GsTx78OdC+IHh+XQNTQRByrCVFXepXpgmq3jL4n+G/BWgXPiK+L3ENqu91hG58D0BNfnf47/wCCmOj26yW/w+0OWdhxvuz5ZU+uFz0r6WHFWV1Yv2NWMrdtfyP6Q8MMNi+KpyxfDtZVVCVpSU1pLz1/4c/TzQNHtvDOgwaPHITFaIF3uew7ntXGax8ZvhboF8unatrtpFMxxt81T+eDx+Nfg74y/am/aF+M102mx6jJbwSH5YrPMICnszLgn3rktO+DNzek33iG8Zp5OWx8xJPqTzXPLiaUmvq8NPPQ/o/L/o6UqcXUzjFWk91BX187/wBXP6QNM8ReHdeUNo19b3gOCPKkV/5E10HOPSv5zNO8DeJ/Cx8/wX4gvNPcHgQyNGP/AB017f4Y+Pf7VHg4LBBrNvqFuvVbld7t/wACIJrspcQN/wASD+Wp87m30e95YLFxflJNP8Ez9ffib4b8VeKfDx0vwlqA06d2G6RgeUPUDAJBrkvhj8HtE+GMcmsX0xutSl/1tzJyfoK+UfhN+1h8ZfFXiODw/r2hWrRSj95cJIw2D127cV9O6p4k1LVzsnfCdgOK/MePvGLLcofs6cXKs1oraLs2fwd9JP6RUPDnm4YqNVMQ1zcsGrK97c736Xs9bW7l3xTrv9r3oWMkRR/d9/WuXFIVBpmcjDV/D+eZziMxxc8XiHeUtW/09F0P8SuLOKcXnGYVczx8uapUd2/0+XQkopq5x8ozS/P/AHa8tRurnzyd+n5i0Unz/wB2j5/7tHKXysWik+f+7R8/92jlDlYtFJ8/92j5/wC7RyhysWik+f8Au0fP/do5Q5WLRSfP/do+f+7RyhysWik+f+7R8/8Ado5Q5WLRSfP/AHaPn/u0cocrFopPn/u0fP8A3aOUOVi0Unz/AN2j5/7tHKHKxaKT5/7tHz/3aOUOVi0Unz/3aPn/ALtHKHKxaKT5/wC7R8/92jlDlYtFJ8/92j5/7tHKHKxaKT5/7tHz/wB2jlDlYtFJ8/8Ado+f+7RyhysWik+f+7R8/wDdo5Q5WLRSfP8A3aPn/u0cocrFopPn/u0fP/do5Q5WLRSfP/do+f8Au0cocrFopPn/ALtHz/3aOUOVi0Unz/3aPn/u0cocrFopPn/u0fP/AHaOUOVi0Unz/wB2j5/7tHKHKxaKT5/7tHz/AN2jlDlYtFJ8/wDdo+f+7RyhysWik+f+7R8/92jlDlYtFJ8/92j5/wC7RyhysWik+f8Au0fP/do5Q5WLRSfP/dppUlssKOTsKSaH0Uw5UfJQN5pcr7C2dmh9MYsPpW1pfhzWtamFvpdtJM56bVP88V9A+Dv2YPHGvyJLrqiwt++/7/4D/wCvX2PDnAGcZpJLBUXLztp9+x9DlXCWY458uGot362svvPmy0tLu+nW2s0MjucBVBJJPtX2r8E/2cbh5ofFHjVPLVcNHAerd8t6D2r6U8B/BjwV4BhV7G3We5HJmkALZ9R6V6106V/YXht9HjDZdUjjc1kqlRaqP2U/Pu10P6H4J8HaODaxGYPmmtUuif6jIoo4EEUICqowAOwrnPGPhu08XeHLrw9e/cuUK59Djg101Ff0hjsDSxFCWGqq8JKzXkftVfCU6tOVGorxe/ofjDrul+IPh54ln01pJLS6t2Kh42KNtPowwcEVzNxc3N1O13fStNK/V3JYn6k5Nfp38dfgtB8Q9O/tbSVC6lbr8v8A00A5wa/M7WNG1LQb59N1WJoZ4zhlYY6V/mn4p+HONyDGyg7uk2+V9Ldmtrr5H8TcdcH4jKMS4u7pX919P+HCw1vXNJVk0i8mtRJ98ROyBvrtIz+NUGLM/mbvmznPfPrSBR3p2BX5U5ytytvTzuv69D4dyltJ3X5ehsv4p8UySxzzajdNJD/q2Mr5TjHyknjjjjtVX+2dZ+2/2p9sn+1H/lv5jeZ6fezmqGBnNJgYxWtTFVJO8pt/1/WpTqzf2n97NG313W7G7a/sbyaK4fO6VHZXbPXJByc1RnmkuZDPcMZHY5ZicsT7k0zA60FQazlWm1yti55NWk7rsadvrus2sYggu54416KsjAD8Aaju9Z1O9Ty7u6mlUfwu7MP1NUaTAHSqniajVnK6K9rO1rjQ2OWFab63rU1kNKmu5mtVxthMjbBjp8ucVn4z1pCoNTGtKOkXp+ZKnJaXL+n6xrGkuz6RdS2pcbWMTshI9DtIyKqi5uo7n7ZHK3m53bwTuz656596iIBppwnFUsTLRNuy2129OwnOV9X/AMA7C98f+NtSsP7NvtWuZYMbdjSsRj0OTzXHlc9+aQhSRu717v8AB74Lax8QtTS5ukaDTo2BkkYY3Adh9a+kyHIMxz3GwwtFOcnpdtux7GU5bi80xMaFBOUn53t/kewfsrfDSSa+fx5qafuovlgz3buw+nSvvXnvWXomjWGgaVDpGmxiOGBQqgelalf6acB8H0cjyynl9LotX3k9z+2+FOHKWV4KGEp9N/N9Qooor7E+kP/U/Xiiiiv8bz/OcKKKKAEKg9enpSAMCcHAp1FO7DrcY8aSKUkUMrDDAjII96+e9f8A2Xfg/wCIr86lcaf9nkY7mEBCqT7jBr6HoruweaYnDu9Cbj6M+04P8Rs+4fqSq5HjKlBy35JON/Wz1Pizxr+z/Y+DlOoeBLQfZSPnRRlwfXjtXjEkMkTFZlKkcYIr9Nt23IYZDdq5nVvBfhXWZDJqVlHIT142/wDoOK/auFfGuvhaKoY6HOls9n8+5/pZ4E/tQ8zybAU8t4toPFcisqkZfvLdOa+kvJ3uj86gCa19J0LU9buVstNiMrsQOBkfifSvtwfCPwEr7/sGR/dLHH867TStB0fRIRBpVskIHoOfz619Fm/jxTdJrBUXzPvayP2Pj79rHlrwMo8N4CftmtHUa5U/RXv/AFqcR8M/h/H4L00yXOGvJh87dcew9q9OA4GeooGe9KTjmv50zPMauLryxFd3lJ6s/wAZuN+Ncy4hzStnGbVHOtVbcm/Py8tLdgp9vbTXc628A3SOQAo6kntSRRy3EgigUuzYAA65Nfc/7PvwGltpY/Gfi2LBHMELdf8AeYfyr7Dw98P8Xn2NjQoq0F8Unsl1+fZFcI8I4jN8VGlSj7n2n2Rb8Hfsp6He+Hba88SzTJdSrvZVOAue2K6f/hkrwJ2uLj/vqvq0ZUcce1Llq/0GwnhNw5TpRpvCxdlu936n9b4fw9yaFNQ+rxdurWrPlH/hkvwN/wA/Fx/33R/wyX4G/wCfi4/77r6uy1GWrf8A4hZw3/0CQ+41/wCIf5L/ANA0fuPlH/hkvwN/z8XH/fdH/DJfgb/n4uP++6+rstRlqP8AiFnDf/QJD7g/4h/kv/QNH7j5R/4ZL8Df8/Fx/wB90f8ADJfgb/n4uP8Avuvq7LUZaj/iFnDf/QJD7g/4h/kv/QNH7j5R/wCGS/A3/Pxcf990f8Ml+Bv+fi4/77r6uy1GWo/4hZw3/wBAkPuD/iH+S/8AQNH7j5R/4ZL8Df8APxcf990f8Ml+Bv8An4uP++6+rstRlqP+IWcN/wDQJD7g/wCIf5L/ANA0fuPlH/hkvwN/z8XH/fdH/DJfgb/n4uP++6+rstRlqP8AiFnDf/QJD7g/4h/kv/QNH7j5R/4ZL8Df8/Fx/wB90f8ADJfgb/n4uP8Avuvq7LUZaj/iFnDf/QJD7g/4h/kv/QNH7j5R/wCGS/A3/Pxcf990f8Ml+Bv+fi4/77r6uy1GWo/4hZw3/wBAkPuD/iH+S/8AQNH7j5R/4ZL8Df8APxcf990f8Ml+Bv8An4uP++6+rstRlqP+IWcN/wDQJD7g/wCIf5L/ANA0fuPlH/hkvwN/z8XH/fdH/DJfgb/n4uP++6+rstRlqP8AiFnDf/QJD7g/4h/kv/QNH7j5R/4ZL8Df8/Fx/wB90f8ADJfgb/n4uP8Avuvq7LUZaj/iFnDf/QJD7g/4h/kv/QNH7j5R/wCGS/A3/Pxcf990f8Ml+Bv+fi4/77r6uy1GWo/4hZw3/wBAkPuD/iH+S/8AQNH7j5R/4ZL8Df8APxcf990f8Ml+Bv8An4uP++6+rstRlqP+IWcN/wDQJD7g/wCIf5L/ANA0fuPlH/hkvwN/z8XH/fdH/DJfgb/n4uP++6+rstRlqP8AiFnDf/QJD7g/4h/kv/QNH7j5R/4ZL8Df8/Fx/wB90f8ADJfgb/n4uP8Avuvq7LUZaj/iFnDf/QJD7g/4h/kv/QNH7j5R/wCGS/A3/Pxcf990f8Ml+Bv+fi4/77r6uy1GWo/4hZw3/wBAkPuD/iH+S/8AQNH7j5R/4ZL8Df8APxcf990f8Ml+Bv8An4uP++6+rstRlqP+IWcN/wDQJD7g/wCIf5L/ANA0fuPlH/hkvwN/z8XH/fdH/DJfgb/n4uP++6+rstRlqP8AiFnDf/QJD7g/4h/kv/QNH7j5R/4ZL8Df8/Fx/wB90f8ADJfgb/n4uP8Avuvq7LUZaj/iFnDf/QJD7g/4h/kv/QNH7j5R/wCGS/A3/Pxcf990f8Ml+Bv+fi4/77r6uy1GWo/4hZw3/wBAkPuD/iH+S/8AQNH7j5R/4ZL8Df8APxcf990f8Ml+Bv8An4uP++6+rstRlqP+IWcN/wDQJD7g/wCIf5L/ANA0fuPlH/hkvwN/z8XH/fdH/DJfgb/n4uP++6+rstRlqP8AiFnDf/QJD7g/4h/kv/QNH7j5R/4ZL8Df8/Fx/wB90f8ADJfgb/n4uP8Avuvq7LUZaj/iFnDf/QJD7g/4h/kv/QNH7j5R/wCGS/A3/Pxcf990f8Ml+Bv+fi4/77r6uy1GWo/4hZw3/wBAkPuD/iH+S/8AQNH7j5R/4ZL8Df8APxcf990f8Ml+Bv8An4uP++6+rstRlqP+IWcN/wDQJD7g/wCIf5L/ANA0fuPlH/hkvwN/z8XH/fdH/DJfgb/n4uP++6+rstRlqP8AiFnDf/QJD7g/4h/kv/QNH7j5R/4ZL8Df8/Fx/wB90f8ADJfgb/n4uP8Avuvq7LUZaj/iFnDf/QJD7g/4h/kv/QNH7j5R/wCGS/A3/Pxcf990f8Ml+Bv+fi4/77r6uy1GWo/4hZw3/wBAkPuD/iH+S/8AQNH7j5R/4ZL8Df8APxcf990f8Mk+BD1uJ/8Avqvq7LUm4jqaT8K+G3/zBw+4T4AyRb4aP3Hy7bfsnfDiM5ne5b/geP6V2Wk/s8/DHSmDrZefjtL8w/pXuOc03IHBr0sJ4eZHQkpUcLBP/Cjsw/CGVUnenQivkjI0vw9oeiReRpNpFboOyKBWxQOelFfXUqMIRUYKy/rY+ipQjFcsFZeQUUUVpe5dwooopryE1cOnSvLviF8JvCfxDtT/AGtCI7gDCzrgMP8AGu/1jV9O0HTpdV1WURQQjczNxwO1fnZ8Xv2i9c8TXsmleEJWtLAZUsPvSe/0r8e8WePslyrBuhmUVUlLaHV+b7LzPz7j/ijLcBh/ZY2PO5fZ6+vkeU/En4eReAtTazgvob1QTwrDcPYr1FeXhjuxU0089y5muGLs3UscmoRyeRzX+cObYqhXryq4anyRb0je9l6s/jPMMRTqVnOjDli9lvb7x9FFFeacoUUUUAFFFFABRRRQAU0DzGCn1p1JjGcVULXuwv3Psj4JfBDwb4jEes61fx3bLhvs0ZGQe27/AAr700/TrHSrRLDT4lhjjGFRRgAV+K+j63rGgXa3+kXDQSpyCpx+fb86+9/gh+0RD4iEfhzxlII7w8RzHgP7H3r+0fArxTyOnGOWSoqjUf2ukvVvVfkf0h4Xcc5ZBLBVKapSfX+b1e9+3Q+vqKQEEZB4pa/r25/Q68gooooGf//V/Xiiiiv8bz/OcKKKKACiiigAooooAKKKKACiiigApG6dM0tBGetNW6gaWj61faBerqGnlVkXpuUNj35r05fj/wDFJQANROBwPkHSvHgAOBS16+A4hx+Fi44WtKCfRNr8mjvwWa4rDR5aFRxXkz2M/tAfFLvqJ/75H+FJ/wANAfFH/oIn/vkf4V44VB60mxa9J8c5x/0Ez/8AApf5nZ/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4Uf8NAfFH/oIn/vkf4V43sWjYtH+vOcf9BM//Apf5h/rNmP/AD/l957J/wANAfFH/oIn/vkf4U9P2g/inG25dS/8cB/pXjGxacBjimuOs4/6CZ/+BS/zD/WbMeleX3v/AIB7lF+0h8W4zhNSB9jGv+Fd1pH7Wnjey2jU7WC6HcnK/wAgK+UsZpelejgfE3PsPLmp4ud/Ntr7mzuw3G2bUnzQxEr+t/zufof4Z/a38J6jIsHiC2ktGbHzrgoPqc5r6S8PeMvDPiq2FzoF5HcK3Ta3P5HmvxdwDWrpGu6xoF2t9o1xJbzL0aMkH9K/XeFPpM5thpKOZRVWPdK0rfLR/cfoGSeNuY0bRxsVUX3M/bP3pa+Cvht+1XewNHpnjtPNQ8C4UYI9yO/1r7g0bW9K1+wj1LR50uIZACGU5/ya/rzgrxIyvP6fPgp+8t4v4l8j+heGOMcDmtPmws9VunuvkatIzBFLHoKWvJfjX4y/4Qv4f3moQtsnlHlRH0Zh1r6HiPOqeXYCrjq20E2evnOZQweFqYmptFNnxz+0f8XJvE2sN4R0WX/QbU4kKnAkfv8AhXyvXsHwO+G8Hxi+JVv4Qvrk2q3SSyNKBuI2ru6ZFfWV1+x58L7nWpvCWieM0fV4uPsxVd27HQjNf524rhnO+Kqk85Ti1OVknJJ30fLFPfS2iP48q5JmeeOWaXTUm0ryS+SufnbRXd/EH4ea78OfGFx4L1pR9phYAEdGDfdP419kL+xCz/CseNP7Scal9jNz9l2D72Mhd2f6V8lkvh3muPlXjQp60b819Nr6eujPGy3g3MMVKrCjDWn8Xlb/AIY/Pyiuo8I+D9Y8ZeKrbwjpS7rq4k8vHYYOCT9K+5P+GQfhfpd7F4Q8Q+MI4NemAxAVAwxHAA3c0cOeH2Y5pSlWoJKKdryajd9lfd+ROS8IY3H03VopKKdrtpXfZX3Z+edFejfFb4aav8K/Fs3hfVHEuwBkkQ5DKeh4rzfBY4AP4V8pj8BVw1aVCsrSi7NdmeBicNOjVlRqK0lpbzHUVp6doOtapvFjayy7FLHap4A5JrNhhlnuEtkHzuwUD3PFRPB1IqLkrc23nrb8yJUKiteLV9rq35iUV936L+yh4E0fw/Yah8VPE8ek3mqAGGAgHBPbORk814/8UP2bvEnw/wDHOn+E7GYX0OqsotZ+gbceMjt1ya+6zHwvzfDUY1pwTu0mk03Fy2TS2vc+oxnBGYUKSquKeqTSabTe110v0PnCiv0Kj/ZC+G1leQeENe8WpB4guU3LbgA4bGcDnmvmfWfgH4y0v4tD4SIgku3dRHIPulG5Dn8OtGaeF+b4VU3KKlzy5VyyTtLs7bP1KzDgfMMPy3je75dHe0uz7P1PCmzwB3qSGeW2kEsJ2upBBHUY71+h4/Y3+Hn2keDm8XRjxEY9/wBm2jJPpjNfDvjzwRrXw88U3XhPXk2TWrFSR0YdiK5eIOAcyymEMRiEuVu14vms+zts/U5M84Sx2XRjWrKy7pp2fZ22Z9//ALOfxYHjTQ/+Ee1iTN/ZrgEnl0HAPPXFfTdfjl8MvFVz4O8aWOtQsQqSAMOxBOOfav2FtLqG9tY7y3YNHKoZSO4Nf3D4BcdzzjKfZYl3q0tG+rXRv8j+ofCfiuWY5f7Ks7zp6eq6MsUUUV+7H6mf/9b9eKKKK/xvP85wooooATNLsmxuMZx61v8AhPQp/E3iay0G2BL3UqRjH+0cE1+8+j/Df4a6Xodp4AuLG0N99iGcxpvbACs2cZ6mv2Dw38JqvENCrW9r7NRsk/5m1ex+hcGcAzzinUqqpyKOnqz+fjJ64pSJAMlTj1r0L4o+EZfAPxE1Tw3IhVba4YRZ7pu+U/kK/Tbw/wCHPCPxk/ZZa40+wtxqMFqQ7xxqH86IZ6gZya8rhTw7nmdTFYXn5atGLdrX5rbrp+pwZBwbPHVK9Bz5alNN2723R+Qu7JwOaeUlHVTj1r0D4beDrvxT8R9P8KKm6R7kI49lb5v61+gP7bDeEPBfgzTPAvh+xt4Lu4Iy6RqHMaDByQM5JrDJuA3icnxGcVanLGm0krP3pN7eRllvCjrZbWzKpPlUGkl3b6H5ej5jhefpUrwTIgkZTg9OK/UT4FfBD4dfDL4ZL8X/AIqxJM8sfnRpIMqiEZXg9WPoa6Twt+0h+zx8TNdHgPUvD0VnHcN5UcrxRqrFjgDK8jNfaYTwcw9OnRhmeNjSrVVeMHd77XfQ+kw/h1ThTpwx+JjTq1FeMWm99rvpfzPyR3Dn2oUl/ujNfVn7V3wW0f4V+K47zwu4bTr4bkUEHy29PcV5v+z3ZWuofGfw9ZX0azQyXShkcBlI54INfm9Tg+vRzhZPX0lzKN1qtXa58ZV4drU8xWW1WlLmSutVq9Dxxg643KeafHFNOcQIz/QV+j37XXgHRtR+KnhnwpotvFZDUZFhJiQIMuQM8AA17n43vfhB+yj4Z0+0Ph9dQkuAEL+WrksBkklhjmv0Wn4MRhXxbxeJUKNB2c7XvfslqfYw8NnGtiFiKyhSpOzla+vofjZIGi4lG360wseMDrX6peL779nz4+/C6412xht9F1SJGZFOyNwyjOCBgEGvmz9lH4B2fxX8R3Go+IAf7K005cdN7Z4GfTjmvExXhXVnmdHAZfWjVjVV4yT6Le/ax5tfgOrLHUsJhKimqiupLovNHyMkM8i70QketRE7TtPWv1u8TftHfs8/DPWm8C2Ph+O7S1PlySxxRsFI65LcnFcf+0H8Hvhj4++GQ+L/AMMkiglVBKUjwBIucEbexXnp6V6eZ+EeH+q1qmWY2NapSV5Rtbbfl72O7HeH1L2NSWCxUak6ablHVbbn5h7JeoQ49aTrX6ufAzwv4avv2TrjVryxglufLuf3rIpfhjjkjPFflZGM6ljt5vp/tV8pxZwG8shhJqpze3ipeiZ4Of8ACrwEMPJz5vapP0uVyrgFipA9aUJIQCFPNfq1+0t4U8Naf+zZY6hp9jBDcFbfMiRqrHJXPIANerQ6h8Pvhl+z/p/jvWdCt70Q20RcCKMuxbA6sPevv6fghFYuth6+JUY04Rm5cr2e/V7I+th4XRWIqUqtfljCKk3bo/8AI/FDy5f7h/KmqGfJQEgd6/Sm7/bE+ClxaSQReDwrOpUHyYeCR1q9+wtofhzxRJ4jutV0+Gdd6FFlRX2gk8DIOK8fKvDHLswzOjl2X41Tc+Zt8rVrK/zv5HnYDgjB4zG08HgsUp817vlellovmfmM25DtcYPpQMtwoyfavvD9uT4UWfhHxXaeMNCt1gs75djrGoCiQc9BwOKk/Yb+FFn4s8UXni/XIFns9PXYiyKCplbpwcgjGa8yh4V4upxG+H72afxf3d79Omp51HgTEzzl5RfVPfy7nwYwZMbwRnpQwZOXBA9TX6aft1+G/D2iz+Hf7Gs4bXfIwbykVc/MvXAGa3/2wvC3hvSvgxplxpVhBbzOYtzxxqpOQOpA7162ceDs8K8elWT+rKL2fvcy0W56WY+HMsP9bXtb+x5em9z8qwScYHWpngnQZKHB9q/UX4HfA34d/DD4Z/8AC3PixEk0jIJUSUZVF7DHcmuh8K/tH/s8fEzW18Gap4fjsYrgmOOWSKNVbPHVeRmuvB+DmHhTo08zxsaVaqrxg0+u13sjfD+HNOEacMdiY06lRXUWnf5vZH5JBt3QU8q6gEqea+vP2p/gHafCLxVbar4eUnStRbKKedhBGRn054r6f/aN8LeGtO/ZjstRsLGCG5ZYMyJGqsckZ5AzXh0/CfFQjj1iZKMsMk7WvzX26rfc8qnwBiIxxSxEuWVFX9UflGuXOEGaMODhlIr3X9maxs9R+NGi2eoxJNE8xDI4DKRtJ5B4r7B/aF8M+HdP/aI8J6dZWMMUEsg3osahW5HUAYNcXD/hzLH5Usz9pa81C1n1tr8jnyng6WLwCxyna81G2+7PzMMUoOCpphDgZKnFftn8c/iP8KfgY1hFq3hmC7+2g7TFDFxtA65x618afFz9pn4V+O/A134b0DwyLC6nC7ZhHEu3Bz1XmvoeK/DHKcqdWjVx6dWC+Hler7X2PV4g4KwGAdSnUxi549OV/dfY+FcnPSnqrv8AcGaaqMzhP7xx+dfrr8Ovh38Mvgd8FIPid4i00apeTQLO+5A5+cZCgHgY9a+T8P8AgN51KrOdRQpUlzSk+ivbY8ThLhKeaTm3NQhBXk3r9yW5+R8sM8P+sQr9Rios/pX63eGPi3+zz8fNNvfD3iPSINIdV4Z1jjJz0Ksvce9fl9440Ky8OeMb7RNLmW5t4ZSsci8hlPK/pVcYcD4fL6VLEYHEqtTqXs0rNNdHHp5BxDwzSwkadfDVlUhPto/mtzlAkjLuRSRTWO0kHqK/af8AZu+GfgrwV8IdNvfGNnbSXOotv3zxqxIflANwJ6V8PftqfDi18D/EpNV0mBIbLUog6hAFXePvAADFfR8XeDuIyrJoZtKopN25o21jzK61T+Wx7Gf+HNXAZbDMJVL/AA8y/luj46Akb7qkj1FIWxnPav1K/YR8K+G9e8G6r/bljBdMZyoMqKxAIHQkZFfL/wC1N8Drn4UeNH1HTIj/AGTqDF4iBwjE5KH+ntXDnXhTicNkVDPacuaE91Z+7fY5Mx4Cr0MrpZnGV1LdfynyvtkC7ipA9TSLuZtqgmv1j8S+FfDMP7Hw1hLCAXX2JW80RqHycc7sZrmP2Vfgz4G0z4ZXHxb8ZWov5Yw7xxkbgEQZ4HQk+9exHwTrSzGngVWVnTVRyatZem7PVj4Y1ZYyGGjVVnDnb7L0PzJe3njXe6kA9MioN3T3r9aPCn7RvwB+J2syeCdf8PQ6fDIGVZZY40XgHqRgrXwF8fPB/hTwZ8Qbmw8FXSXOnSgSRFWDbcjkZHoa+Z4s4FwmDwkcdgMXGtC/K9LST80+nmjws/4WoYfDrF4TEKpC7T6NNeTPFgsjfdUnjNKY5h1Rvyr6M/Z6+MHgr4TyX7eMdIGqi6C+WNiPt25zw/rX6g/CTxj8Lvi14IvPGmneG4LeKzZ1ZJIYsnaM5GBXt8BeGWXZ5SUY41QrWbcLXslvr6HpcJ8E4TNIJRxSjUs242btY/DIo6/eBA9cUm19pcKSB3r9Bfid+098JvEHhrU/CmleFhbXUm6JZhFENrA4zkc9q9TPhjw4f2J7zWfsEAvFs2Il8tfMB3DndjNLDeGWCxU8R9RxaqRpU3Nvla2v7uv3jw/A+GxMqywmJUlTg5Xs+nQ/KUNlttLiQDLKR9a2PDkayeIbSORdytKgIPTGa/Tf9snwz4c0nwH4dn0qxgt3kkUO0caqT8o6kAZr5zhzgKWPyzE5j7Tl9jZWte93bujxcj4UljcHWxnPZU2tO93b8D8sjHJ/dP5GhkdfvKRX7deNPEPw4+D/AMJtJ8W6x4et7xZLeBTsij3EmMHJJArlPBD/AAJ/aq8K6hYafoi6fc2wAI2KjqTnDAp9K/S8X4E4f6x/Z9HGx+sOPMoOLV9L77H2lbwtoqv9Tp4pOs48yi0107n42FgBk9Kmjhml/wBUpb6V9KfDj9n698XfG66+GUrlbfTpmFxKOyJzge5HSvuPxp8Tv2e/2cZ4vBNnoiX9zEAJAqI7L7sW9etfHcPeFqrYWWPzSuqFJS5bvVuS0dkfPZPwL7TDyxmPrKlTT5btN3a3sfkI+YzhxjPrShWbO0Zx6V+vGs/D/wCDn7UPw5ufFXgS2jsNTt1JwihSjYzscLxg47V45+w34Q0yfxZr2meJbKKd7QKhWdFfawJB6g16q8F6ss1oYOFdSpVk3CaTaaSvqt7+R3f8Q1qPH0cNConCrrGS8u5+dLBl+8MfWmgljhRn6V+i/wC3Z8JLDQLuw8d+HrVLe2kHkTLEoVARyGIAA5zivOP2K/hZb+O/iC2v6zbrNY6apYq67kdzkBeevXNeDX8KsXHiP/V9S95vf+7a/Nb7+p5NTgXERzlZPfW+/ddz4yKsp2sCD7il2Sf3T9a/Vf8Abi8LeHNF8MaVNpFhBbM12gJijVMj8BXrfiDWfh38IvghpfjjV/D9tejy4EZVhjLkyd8kV9c/BGnDF4vD4jFKMcOlJy5Xqn5XvofSrwwjDEYijWr2jSSbdm9H6H4mlHXlgRUW8Zx+tfs98OdT+CP7T3hzULCLw+lhJbjDjy1RhnowKe9fnb4F+B03jT42T/DizkJtre5kEko52xIxGT79q+d4g8Ja1GWFll9VVoV21FpNarumeHm/AFWk8O8HUVSNb4Xa33p7HzzHFNK22NCfpTH+Q7X4PoRX6/8AjXx7+z7+zJ5HhC20VNQuwoMgCI7gHuxf19KLjwV8Ff2q/ANzrXguzj07U4FO3YoRkcDgMq8EGvfq+CtCUp4TC42M8RBNuC8uifVrqetU8MoSc8NhsVGVeKu42fTdJn5AYc/dBP0pGJQ4I5r7t/Yx8H2Y+L+qeHfEtpHcG0iZCkqBhuVsZAYHrXi/7VOn2Ol/HDWbPToUghQx7Y0AVRlB0A4r4DNOBJ4XIqWcTn8UnHlts1fr8j5TH8LSo5XDMnL4pctu1tz57AdmKKpJobch2uCD6GvXfgb4103wL8RLPWNato7mydhFOkqBxsYjJAIPIr7I/bM+D+j3GiWHxY8DW8aW0iqsywqAuG+62FHqeavKOBXjslrZphanNOk/ehbXl/mWuv3FZfwnLFZbUx1Cd5QesfLufm2ivJ/q1z9KaSQcEc+lfq78CPh14T+D3wPuviT8QrSGW4u4zKqzorbV/hADA/e4P4188/s5fDzRvj78XNR8QeJIUSxhLXH2aPCg5b5UwMcYNfQVfCHEKtg8Eqq9vXV+W1uVd279UevPw8q+0w+GjUXtaqu4/wAq7nxcsE7JvVCR3IHSoTuUfMMGv1y8Y/tE/Bb4Z+LpPh3ceFkMdq4hkl8mPA7E5YZOK+f/ANqPwf8ACE/2d44+GtxAsty48+3iYEYOCDtHQ9jV8Q+F+Cw1CpVwWNjUlTaUo25Wru11fewZvwRQo0pzw+JjKUGlJWaa9E9/kfCHlzdkNI0T9WDD8DX7deMNb+G3wi+Emj+LdY8PwXYkt4FISGMtuMYOTkCvmDXv2uvg3qmi3On2ng8RyTRsgbyoRgnv616vEPhLlOVzdLF5glOyfLyt7q6V0d2c8A4LAN08Ti0p2vblf6H5wAnkGvXvhR8Xdd+GurqY3aWxkI82InjHcivJJmEsrMBt3MSB7E1HyeVr8cyXOsTl2IjisHNxnFpq3Xuv+HPzrL8zxGCrxxGGk1JdT9rvDPiLTfFejQ63pLh4ZlBHsfT8K+Q/2xNUngstH0sH5Jmkdh7ptx/OuE/Zf+JM+ka+PBepSE294f3eT91/8DXSftkn/StEHos3T321/Z/GvHqzvgOpjqTtO8YyXZ3jf+u1z+j+J+KlmfCc8VB2lopet1p8zl/2KlA+PunAf88J/wD0XX17qvwp8AeGvjjdfFXxH4stITFJ5pswdsgIXoTnn8q/Pb4CfErTfhJ8SLTxpqsMlxDBHKhSPG4l1wOvFYHxZ8awfELx5f8AiyxieGC8cMschGRxjnHFfhvDviBgMt4fo0/ZqpWjUcknf3dFaWmj+Z+a5RxbhcFlVODgp1IzbSd9Oz0Pp/Wr/Tv2kP2p7eXRE36cHjV2x1SIYLfTNfoKLH4hr8bEHkKfDH2PyCd4/wBZj+7X5Ufs5fGLwr8GNWvtd1qwmuruaIxwNEVwuRyTuPqBXPN+0D8SW8XHxJ/aVwIxcibyfMO3aDnbjPpX1HC3ifluAw0K+KvKtWqupUUdLdLPSzTu3ZHs5Fxxg8LRjVxF51ak3OXLdW8ndaryPQvEmieI/gt+0ncSeFLF7yWCczQRIpLPG3LYH5819I6rrv7PPx08VxnxOLvw/wCKZdoLYKEOAAMsRivC/iJ+1Do/iD4g6J8TPB1hLb6jpkfk3Hn7dsikc42k9cnrXoUn7TX7POq6unjjVvCcra1Hht6ldu4DqBuAP4itMhz7J8PVxGHp4qPsXU5uWcW4uPeOialbQ1yrNMupTqUqeIi6TnfllFuLWusba3W3yR82/tGfDvxN8PPHbaT4gvW1FHQNDO/Up2B+ldl+zJqHwItbq4j+LkIkuCR9nMiFkHPOcV5Z8bfi7qfxj8Xt4hu0+zxIoSKIfwqPX3Nbvwb+KHgbwDbXUHi3QU1cykFGbHy4PvX5rlecYDD8STxWHnFUeZ2c05K260/XofEYDM8JSzp4ig0qd3ZzV19y1/U+9PHVz4m1DwvfxfB6/wBEfTBA5eOFQswQKcjJPpX5JRySxTiQHDKcjHYg19w337TnwxGlXenaP4X+yPcQvGGjO3BdSM8H3r4itJYIb6OaVd0auGZfVc8j8q6/FPP8JmGKo1MLV5raP4rLXRJPZdbJ9DfjvNMPi69KdGpd6p72WvRPY+s/hJ8NPHXxx1GHxJ48vZF0LSsM9xMcAKvJVO3brTv2lfjoni/xjZWfgaVo7TQlEcEw+8WX5dwPpgV7bD+2B8Ez4Kh8C3Phy7+wxoqtHEUQHA5yVYE5r578W/Ev4Cah4i0bU/CPhmeztrG4827iZgTMgwQo+Y859a+ozuvlVHK4YLLcdH3nF1HaXNJ/doo9ru7PdzKrgIYBYXBYqPvNOb97mb9bWtHfc9R+B3w31i+1D/hfnxovXgsbMeYjznDzEDAx7dK7n4I/Eyz+LX7V194odPLh+xyJahuvyEBW6dSOaTxV+158CvGmkQ6H4i8MXktpb/chVlRB+CsAfxr5d1b4weFPD/xOsPHnwc0p9JgtMb4JWyH9RwTwa9ivxHlOVTwiy/EKdGnNSkrSc5ys05PS1o30V0eliM6y/L3hlhK6nThJSkrS5pN7yei26HU3VxrQ/a6LAv8AaBrIA5P3dw4+lb/7dqW3/C3bbycBzaKZMf3snrXpp/aj+AsusD4jSeHJB4jC8uMYL4+8Bn179a+GPiX8QNW+JXjC78X6zxJcN8qjoq9gK+P4yzfLqGT1cBhsR7aVWpz3V1yx31bt7z2sfP8AEePwNHLp4OhWVR1KnO7dF5369zg1Yr904I6Gv2A+D+oNqXw40qZzllgRCf8AdGK/H88Cv1m+AWT8L9OJ/u/4V939Feu1mWIprrD8pf8ABPpPAepy46tT7xX5nstFFFf3Gf1If//X/Xiiiiv8bz/OcKKKD0oA+0v2HvAP/CUfFEeILxPMg0tDIc9CzZUfka+1/EugfFyX9pPT/FthYO2h2a+Szj+JHGW79mrxX9mLxx8NvhR8GL7VbzV7RNXu1eYQlx5gwPlQr16j9a+XLz9r742PfyXNtqZWJpCyqBwFJyB19OK/rnKuJsl4fyTBYTFSk5tqo/ZuOjv8Mj9/wWeZZlGVYahVk3JvnfI09f719T3D9vzwD/Z/iew8eW0fy3qGKYgcBkwF/Pmtn9gPx2q3uqfDu9b5LhfOhU9253/piux+LHxM+Hfxi/Zuji1TV7Vdbit0m8l5FEhnQcgAnPJr8/8A4I+Nm+HnxO0vxEZPLijlCSt28tuG5+leJnmc4PKuNqWbYSonSrWbs07c2kk7ba6s87Ms0w+A4np4/DzTp1LN289Hc/Qz4LfBL/hGf2mPEGsXMRW108tLbsRwWl5OPpmvkD9p/wAer43+N02yTfa2EqwJ6AqcP+ZFfpl45/aE+EmleDtS1fQdXs5b+W3baqSKZGZlwBjqcV+Gd/qFxqV9NqV0d0s7s7H1LHOfzqvGHM8DluCoZRlVRTi5SqSs093on6bfJD8RcbhMDh6WXYGacXJ1JW166I/Wz9q9J5/2Y9MfSMtb7rYnb02YPX2r8ktPiv576KHS1bz9w8vb13Z4x75r9JvgB+0V4B8R/D8fCT4wMkcKR+THLJgIY+gBPYj1rv8Aw98PP2Qfhdqw8cW2sx3UsB8yGOSdZFBHIKrjkjtXVxZwzg+KcTQzjDYuEKfKlNSkk42WujN+IMjoZ/WpZjRxEYwcUpXaTVuyPzN8Z2XxFtIoR44N1tJ/d/aSSPw3Zrs/2bSB8cvDn/X2v8jXU/tNfHGP4zeLlbR0MemWY2xDGC57sR2rhPgJqum6D8X9B1fVp0t7eC5VpJJCAqqAeSTX49l7wdDiaksLVc6UakbSl1Ser8kfnOE+rUc8pujU5oKa959bPc+yP249S1PS/iB4e1fSMi6tf3kWASQy4IOBXUaP+1r8M/G2i2/h345aMY5lUDe8e5MjjcC2CM+1ch+0z8ZfDFt8WfDXjLwfewapFpzh5VhcOCuRkHGRz0r17xU/7MX7S1hZ69rWqx6fewxhcGRYpAOpUqeSM9K/oGOYVKmcZhPK8ZBTcl+7nbkmu972vpY/XVXnUzHGPL8THncl7srcslZa3/yON8dfsxfCL4keBrnx38F7nDxIz7VYsjbRkrg/dP0rqf2J440+EGsWdvxdxvIrjvnBxUmrfE/4H/s8fDG78IfD/UF1G5nVgFVxIxdgRliOgFfGP7M/7Qo+Efiy4bXAX0zUm/fgfeU54YfTNZ4jiDIsqz/DTbhGVSm41XB+7GT6q34+QVM3yvL84oSvGMpQcZ8vwps+atfW7i127ivQRKJ3D7uudx65rs9P0z4pDwx9p0/7aNJ2t9wt5W3PPHTGa/SnxD8PP2QfiZqv/CbTaxHbSS/vJY47hYwSefmXHB9a81/aF/aG+H+i/D7/AIVH8ItkkO3ymlj5REBydpHUsetfmmP8NMFltGvjcbjouK1pqDvKfqr6bHweN4Gw2DpVsTicXHls+Xld232PeP2U5NJh/ZiSfxAN1mPtBmH+wHOa8oHin9ilrjEdqN+7n65/xpnwU+JngLRf2W5vC+q6rbQX7x3AEDyAPlmOOPevzEQoNQWU9PMzntjNfb8T+Jn9n4TLcPho06n7uPNdKTT0XnY+tz7jNYTD4OnQUJ+4r3V2vn0P2L/bDfTZf2ekfRhi1LQeUP8AZ3DH6V6Et14Dsv2ctPm+JCeZpQtYfNH/AHzj9cV82ftF/EzwD4h/Z4s/Dui6vbXN6iwboo5AXBBGcj2r1ay8VfAnx78DLDwB4v8AElpbK9vGsqLOqurLg49uRX6TTz7DVc3xkqFWnzSowUeaS5ebXTfbXU+xp5vQqZliZwqQvKnC12uW/bc8L8TeKP2NpNCuk0W2AuTGRFx/Fjj9a6H/AIJ8kraeJWX7uUI+nOKwrv4DfsgR2srweLFZwpKj7WnJxx2qv+xl468BeBB4ktde1a3tI5HCwmZwu8DOCCetfD5Dia2H4mw2IzKpRiuWavTaS+F7+b6HzWT1KtHOqFbGSpRVpfA1bbqe06vCn7Q3wN1vQWPm6ro88ijuxZGLDA9xxTNLWP8AZ4+A+i6ED5OrazPCrdm3yMG5HsuRXzX+zh8Z9F8DfG3WYNWvEi0nVJJP3zN+7BDEhgenPSov2kPjPo3jv416Pb6TeJJpWlSRnzVYGMksCWz7etduH47y7+z4Zupr61Jqi9dUlLWXzjpc1hxXg1g45ipL6xK1JvrZS1l9x6/+38f33hn/AHz/AOhLXW/tjGMfBjSDL9zfDn8hXjv7anxC8F+MZPD7eGNSgvfJcmXyXDbfmU5ODwK6H9rP4keBPFPwh07SPD2q213cxmPdHFIGYYAzkClxJn2EvnU41YvmUOXVe9a22utvIedZvh1LM5Rmnfktrv6Hon7Wazzfs46bJpuWt1ig37eRt2Dr+NfmBpXgTxpatY+IPsMy2ssseyUA7T8w6Yr7x+Af7R3gHxN4B/4VR8Y9qRBPKSaX7jL2yT0I7Gvqj4fXnwG8CaIvhPSdet72zuJc28NxMshUnnatc2N4byrivGUs4ji4wi4x0ulKMo6Ws+noZ4jIsDn2KpZksQox5UrXs1Jd77p7Hjv7bbRJ8ItHt7w5u/Pi6nn/AGqn/aY2v+yrZFBnCwZI+or55/bt1/xXdeNbHTbyHy9LgXfbMpyJGPU/UYHHavXvg58d/hP8SvhXH8L/AIszJayRRiJmlIVXA+6yseARXVj+IsHjc4zbKa1RUpVIqEXLRXimvxOjEZ1hsVmeOy6cuRzgopvZ2X3Hxb+yzh/jjoe1TxMf/QTX2l+0ic/tKeD9p/5aD+ldb4T8Mfsn/A2/bxrpesR3V1GpMQedZWXj+BQM5+lfHvij42ad8Sv2itM8XSv9k0u0uEWJpOMIvVj6Zr56jDDcP5PRyrE4iEqs60ZvlaajFNbniRpUsoy6ll9erGVSVRSfK1or7t7H6LftA6x8DtObTP8Ahb0PmEq3kfkN1fAPx11z9mq/8GPb/DGHZqJcYIGOM896+yPjDD+zR8a/sJ8V+KbeM2QOzybhV+8ADnr6V8lfFn4Pfs0eG/At3rHgfxIt7qMW0xRC5V92TyNo9q9/xVr4vFRxMqEsPKi1vzR57WV/O/Y9jj6eJrqvKg6Lp23uuc+FU3bxjPXj1zX6KfCD9rWx8P8AgyHwL8WtKkuLCJBCkvl7gyYwAwbA4Ffndb3DW9xHcL1Rgw/Dmv1j8KfFD4GfHr4XWvgj4kXMenXduiq5YiMl1GAyseufSvxvwcrVI16zwmLVGry6KSXJPXaVz838Np1I1aiw+IVOdtFLaXk2WLf4Qfsy/tCWFzcfDqQWmoIm4iI4KZ6Ep0xXwLoPwg1mL44wfCy7HmTQ3aq5HQop3E/itfoh4Ih/Zq/ZstrzxFo2uLdXUqY2+aJG2joFUeua8X+AHxC8B+Ifjfr3xg8bX9tpvmcWyTuFbP3Q3PqtfqfEeS5VisZl8MXKlDEczdT2bXJyrXXom2fd5zleAxGJwkMS4RquXv8AI1y8q1+Tb+8+l/2k/BnxE1fRNB8M/DOzeWCxlSR2j42iLgL+IrmP2vPA9/4w+B9t4lu4NmoaWqySLjlRj95/KvlH4vftd/EL/hP9QTwHqQj02N9kWzlW28bge4NfQvwP/aE8O/EH4X6p4Z+L+rwQ3Uu9N07BN6SDtk9q92pxnw/nVfH5ZGcourFq8mlC8dI8v3Hqz4lynM62LwUZNOomrya5bxVo2/4JF+wQ5X4f606cESk/+Oium8JeKdA/af8ABGufC3xcy/2vp00ywt0YhXIR1+nANeefsn+N/h98PNC8R6Nr2tWltuupPJLyAB1xwVz1FfC/h/4jan8PfixP408PS52Xkr5XlXjZzn8CDXgVOPsPluW5ZhqslOlOMoVY3vZO3RbNdLnlz4ppYHBYGhValBpxmrrZvd/mj9Sfip4cvfCX7J134c1QYmtLXy2x0O3HI9q+OP2ev2nNS+FOit4W8WadJeaM5LCRULFA3UY6EY9TX1P8bPjz8N/iD8AL+PTtTtxfXluCLXePMD91xmvL/wBnj43/AAt8RfC7/hUfxQaO02IYVkcBVMZHHznoR716/EmZYWpxHSnluOVJqiuRu0oytf3ZX0R35xjaE86pPB4lQtTVnvFv+WXyO/0rQv2Tf2h7g6fo8S2eqzBmWNP3T5xknaODX56fHj4RXvwZ8byeGp5PPhkG+CQ8FkP9RX6H+BfAH7Lfwb1//hPbLxAk00AYwq86sBkEcDucGvhP9pr4u2Pxh+IJ1jSlIsrVPKhZhy3qfpmvivFmlg3k8J432X11y/5dtaw6uVtP6+75bxAhhv7NjPE8n1nm/wCXezWursfOgJziv1r/AGLP+SDa9/12m/8AQK/JU8HjvX6Y/smfEnwN4V+C2r6R4i1S3tLqeWUpHK4ViCoAIB6818f4FY+hQzapKvJRXs5q7dldrRangeFWMpUcwm6slFckt/Q/OTXv+Q3d/wDXeT/0I1+0fwsufCtn+yrDc+N1DaStuftIPdMivxX1iZJ9Wup4zuRpnYEdwSea/S2T4leA/wDhju68JjVbb+0Ws2UW/mDzN2Rxt65r2fBfPqOBeYV5yin7OTSlazavpqej4Y5pSwzxlSbSfI7J9X28zQ0/xP8AsXvqEKWNsPMLALwc57V1H7c7QN4H8PtaD90bgbf93C4/Svyg8PTR2+v2txOwVFkVix6AA1+kP7XHxI8B+LPAugWHhvVra8ktpFMiRSBivyjOcfSvqMo8Qv7T4ex9PERp05JxSUUo395X06/oe7lfGCx+T4uNZRhLSyVlfX1+8+pvH/gnwP47+D2jaP47vxp9p5EDeZnAJ8sDFYugeE/hp+y98N9R8ZeHhJdwzormZTuLjB249BzXzv8AtNfEvwL4h+Amk6HoGrW11ewpAGiikBcFY8HgHPBpP2afjX4J8S/Ce++F3xWv4LaOFDHE1y4USRvngE/3elfo2J42yt51Uw9L2cazpLkq3Xxcr0bvbyPsqvE2BeayoU+RVPZ+7U0ettm9g/Yl8Sr4w+Jni3xHfgJc3+2UD6ls/pivjP8AaPjvIvjVro1EEP53f0IGK2PBHjp/2f8A4zS6noVzHqNjBKyM0TbklhJ5wR3x0r7z8T2v7Kf7RPk+Kta1NLC/2jeBKIpPo4I5+tfkGGo0uIOH4ZR9YhDE0JttTdlK71d9n1Pz3D0Y5tlEMvVWMK1KTfvOyku9zzz/AIJ8R3ixa5JKG+ynbuz0LY/wrtP2YTDJ8cfH/wBmwYzdPtx06tVXxZ8bvgv8A/h/ceDvg/JHe3kqlQyMHBYjG52GORXjH7FnxD8NeHNc13UvGupw2cl2oYNO4TexznGfrX3WTZ5l+X4/LMljXjN0VNzlf3byW13ofTZXmWEwmKwGWKqpOkpOUr6Xata59Y3lxa/HXwH4x+G19h77SbiRYF6sQgDRk/VuK5bwNYN+zV8Ao5L4CPVtSuFVk7l2cJgH2XmvnH4Y/GfR/Bf7T+sarJeR/wBjapMyyTBvkIx8jZ6YBq3+1j8atE8b/EHRdG8O3sVzplhLHK8kbApv3eo44Fay49y76hLN3JPFRborVXa5tJenL1NP9bcH9V/tJyXt4t013tff5I9m/bbkeX4d+HnkOSZoiSfUivYfHus/D3RP2eNKvPiZayXel7bcNHGMtv8A4T26GvmX9rj4jeBvFXgPQrDw3qttdzQSxGRY3DFQBySB0xXuOqa/8A/if8HdN8B+MPEtrbxrHC7hJ1Vw0fODmvchnWHq5pmf1atTcpwgo88o8rdvPT1PUpZlTnjsd7CpG7hGzbXK3bzf3kvwb8S/Crx34a1Twx8CHOh3+zc5kjHmYPAJ55GfyrxT9kPw3qHg34/eKPD/AIpbfqKW7EuT97dIG3fj1r0nwFf/ALLH7PMF3rvhfXEvbmZNrESrM23qAoAFfCy/tEX9l8eZ/i/psWIppQrQk/eiA2jPvjn6181nvFWBy+vluKx9SEq9OT5lTd4qD0vba68vM8XN8/wuCrYKvi6kXVg3dQd4qLTWy0T1M/8AamS/g+NmqDUg2Sw2Fv7vOK+mv+Cesd8us69Od32YRJk/w5ycV634lm/ZX/aRgt/EfiDU00+/VQrfvRDLgDo2RyB2rM134y/A79nfwNP4W+E8qaheTqQrI4kJY8Zdx6eleVk/D2CyjPanEtfG05UFzSjaXvS5lomtziyrJMPl2azzqriYuldtWd5O62sZnwJktX/a28UtZkGMpxj8M18c/tbkH4960MZ5j/8AQBXpH7HfxB0LRfirqPibxtfxWX2qJmaSZwoLs2cAmvo/4h/Dz9k/4k+LrnxjrXiuJbm7K7hHcoFG0AcDB9K5K2Xx4g4WpUMPWhGXtZTalJLRtnHWw0c3yCFKhUhGXPJ2lJLe/c/JfJzlOor9af2NviJp/wASPA1x8KPGCC5NkuY1fkNGeg+oPNfDPx/8E/CzwXrNnbfC3VBqdvIhMhEok2n8OlemfsV+MfDHg3x9eX3im9isYngwryuFBPpzXxPhTiZ5JxQsHXqR5XeMne8Gt99mfM8BVZ5Zniw9Wa5W+WWt4233O5/bg+LC3OqW/wAJvD7CO101V89V4GcfKpx1AHNfNXwJ+LXiX4QeJz4i0O2a7hkXy54sEgqSD1A4PHFJ+0nrWkeI/jPrOr6HOlzazMhWSNtynCDoa9H/AGS/jfoXwq8R3Wl+LE/4l2ogB5MbtjjgH2GM1y1M+ljeMJ4mtivZe+0prVK2iS7I555s8TxHKvWr+z95pSWtraL5WPq7/hc/7LXxruEt/HdgtlfSYVnmQRtuPbeOevrXz/8AtI/sz6Z8MY7Txn4LlaXS7iRQUY7tmcYIPcHNfQGs/B79k3xZ4ifxx/b8cSTyefJGlwqruJzwMcV5l+1T8f8AwT4g0Wz+GngOZbi3gZPNlXlAqYwAe54r9b4xjh55VXq57OlKrdeylBrmlr1sfovESpSy+pPNZ03UuuRw+JvzPsjx1e/DXT/gzok3xRTfp/2e3wD/AHvLFfFfxF8SfsjXHgrUoPCNuF1JoWFuefv8YxX0t4k174AfFD4XaV4P8W+JrWFIYISwjnVGDKgBBr541v4GfsjWukXFzp3ixJJ0QmNPtSHLAcDGK+i8Q8XicXzvAzw8qbhvKUee9tfn2PT4xxVavzSwkqLhype84uW2tv0Pzjydx3dzxTqWZUSVlQ7lDEA+2aSv4aqKzP5gs1ozZ8N3txYa/aXdsdrpKhBH1Ar63/a7mW5/4R+4X+OOU/ntr4+0eNptVto4+WMqjH4ivr/9re2e3tfDi4xiORT+S1+ycNOb4PzKK+Hmp/J8x+jZI5vhzGp7Jw/M+MgCelIRjrXrfwQ+GcXxb+INt4JnufsizpI/mgbsbF3dOK+sLj9jHwNcapJ4a0bxtby6rHn/AEZkG/IGcEb+K+Y4d8NM0zTDLF4WKcW7K8km3pok2r79Dw8q4Mx+NofWMOly3tq0m35J7n56UDnmu18e+Ate+Hni648Ga4m26gYAEdGDfdI9jX2En7EWoP8AC3/hOv7TP282ZuvsnlnrjO3Oe/0rkyXw+zXMJV4YWnd0b8ybSatfTW13p0Mcv4Sx+KlVhRp3dP4vK3T1PggDPSjGK9M+E/w8/wCFk/EC18Dzz/ZTcFlZ8btpX2r0j9oj9nm9+Bd/ZKl0b20vEJEuzbhgfu9TXHS4NzCpls82hC9GL5W/P03MI8OYuWClmEY/u4uzfb+up810V9d/s/8A7K998ZvDl14nv746fbxNti+TdvI69xjFfMfi7Qj4Y8TX3h9JPNFpK0YbGM471ObcH4/BYOhj8TG0Kvw6q7+W6FmHDuLwuGp4qvG0Z7dzAopQrNynPtV3+y9UFmdRNvJ5AOC+0hQfrXz8cNUd2lojxvZy7FGgHPStzwx4c1nxdrEOhaFC1xcznCIvXNfUvxR/ZRvfhZ8KY/HmsagGvsoJbVV4UucY3Z7fSvoco4NzDG4Srj8PC9Omrt/1u9dj2MDw7i8ThqmLpQ9yG7/rc+PqK+yfh9+y3pWpeC7fx98S9fi0GzuziFXA3N7k7hj/AAri/jj+ztffCezs/EWkX6avpGoECG4jGMluVGATnPrXr43w1zWhg/r0oLlsm1dcyT2bje6TO/FcF5hQwzxVSHupJvVNpPZtLWx81ZA61Gyc8V9x+Df2R9MPhO18WfFHxBDoK34Bgikxk7umTkc+1eQ/HT4A6z8Gb23n+0Lf6bejMFygwDxnB5Paozbw0zbB4T63iKaUVa6um432uk7oeYcFZjhcP9ZrQ93S+qur7XW6Pnleh/Cv1n+AP/JLtO+h/pX5M9FO3rX62/AmAwfDHTVP8UYbn3Fft/0Wk3mmIf8Ac/VH6T4EL/bqv+H9T1+iiiv7lP6kP//Q/Xiiiiv8bz/OcKKKKAIyuR939afltuBx60tFODcfhDuRhccEUbSWyakopdLE8pGVJowcbccVJRTW9xcnW4zGOMZqVpJHGxuQPU5ptFV7R7L+v6/plRVthoBAx1pm1u4zmpaKzauFhmCePuinKzqcplfocUtFXGbWv9f5DeqEYszb2yTTeeoFPopczJcUwDyKpVcgHqAaZ82elPopubbuy22R7MtTjuzwadRSv1/4H5WJsNXIOcUEN2JA9KdRTU3s2NNrYT5u5zUe09xUtFN1JNWuD1d2MKkr70Ffxp9FSm07ishuM+1IVyenFPoovtcpu41l3dTU0dxcROrxMylDlTnoRUdFUqkk7pi683U6DWvFvifxHFHDrd7JcrD9wSHdj6GudO773U06inVrTnLmm7vz1/MupUlN803d+ojPI/38tj1NNw+OOnpT6Knne6ZnbSw3DY60gXngYp9FP2jswa7jNnNLhshlOCKdRULTYTiDPI4+clj7nNRkEjDDNSUU+Z2t0HbqM2k9TRtNPopqWqYlFWsMwTwR0owx68Cn0UczDlW7GBSDkdqMc7u9PoocmUK8kjqFJJx700ZHWlooc2wepGQxOTS4OAMU+ipTtsJojIbG0dKCGPHWpKKd+ouQZgkZxRjH8P60+ipsivMZgZ4XrS47tye3tTqKa02Fyr+v6sMC/hTleRDlePocUtFPmewWGlnJzSYOcmn0UJvrqPzGY56YxSbSPu1JRT5iXEYFwdwFGPbrT6KTk3ux8qG/OOFpMEHPWn0UNjd+rEVmQ5XP4HFGXOST1paKtVZX5riSsMIPcZpw3DkHA9KWikqjQ1dO8XYb8xGSeaQqSPen0VPMDbe4zaQOOtOK9u1LRT5n0EkO3uE2Bjj0zUQUnqMEU+inzvp+g3Z7obg9jSYyfmGfxp9FJTsKUU9H/X3jCAv3eBShgTgUpGa6Twl4T1fxjq8ekaPEZHkOMgcAdyT6V15fl9bFVoYfDwcpSdkkv626s3weCqVqsaNCN5PZHq/7PHgabxd44hupk3WtmfMkJ6cdq+pv2rfDB1bwNFrkIy9g/bnCN94/oK9b+Fvw5074ceHI9Lgw87AGZ/Vv8BXZ+IdFtPEei3Oh367ormMo34iv9BeH/CJYfhGrk9S3tKibk/73T7j+ucn8PVR4enl8v4k1d/4uiPgH9ir/AJL7poP/ADxuOv8A1zNfYF/8HvCugfHO6+LHiHxZZ28cchkNqrhZRgYwcn+lfE/w412L9nL44DVvFdvJJBZrKm2IcsJFwCMkcV5X8XPGVl4++IOoeLNNR4re7fciSHkcY5A4r+b8p4wwuS5NTwmIpKeIpVW+V3TholzO2+q7n4zguI8PleWww9Smp1YVJPlk2uXz03Pp7xHdaX+0T+1PbnQU36d5kaM+OqxDlvoa/QYQ/EWL40rYfZP+KX+xeSX3DHmYwPlz0r8rv2bPi/4N+Dmsah4g8Q2s813LCYoGiAIGeuckdwKw3/aN+JzeLj4k/tOfyftPm+RvO3bn7pGemK9/hfxNyzAYWOIxTcq1ao6k1HRRWqSd1Zp3eiPVyLjjBYWhGvXblUqVHOXL06a6ba3se7+C/ArfD79shdDRCsPnSSRe6uucj8c19T/GzSYfjroHiHwHaIG1TQZ4mtwfvMHUEn1wATXyt4n/AGnPh3rnxa0D4o21hdLLp0RjuRtXLDHBXn1P5Vi6H+1Pp2hfHzUvidawTHTdSRUeEgb8BQOmcZyK9DLOL8gwlCrlrqqVCpVknvpBx0e3SX4nZhOIsow1GeBdTmpTqSva/wAMuvyZ99fC2Sy+HM+kfBayC+cmnSXN1jtJ8vJ+uTX44fFoAfEnWRnH+lvn86+kPB/7UOmab8c9V+KfiKCaS2u4Ht4UTBdVONuQTjgda+VvG+t23iTxZqGv2askd3M0qhuoB6Zr4bxU43wWaZdQpYWavCc7LXSOij062PmuO+JsLmOCpUqL1jKWnVR+z9595fs9f8M0t4PtRq32UeJQp3vehvLD7jjuARjFZn7S5+JTeCt7nSX0ESDa2nBR24yNxPSvMfAHxs+D3hvwlaaL4i8LrfXsKkSTf3iWJz19KqfFf46+APGfg4+GPCuivpr7w2dx24+mcV7GYcWZfPh94NV4KahZKmnBt9pK1n5vQ9DGcR4N5U8M6sVK2ijzRu/Poz5q8O+JNa8KanHrfhu5a1uovuyJ94Z9K/R34n6vqWu/sXWGtavK1zdTmJpJH5LHzO9fmKuQQo/WvrLxF8ffDOsfs7WfwkgtpxfW/l5kOPLO1txwc56V8LwFxJQwmCxuGxFWynTaind3d1a1r66HyPCeb06GExVKtO3NBqK89L2W1zmPhv4W+KXx/urTwj9plfSrEhneQ4ihUDr9cdK91+P/AMRPCkUHh/4IeGphd2WjzwC4n+9l0IXAP55re+G37VHwX8DfDiHwRJot2jPHtuXh2gyMep3Ag14L8WPH/wCz9rmgiP4Z6FdafqvnLJ58zZBA5Pc859q+1njMsy7J+XB4yNSrNRdS6lzO2qhFWskvkz6ipjMHg8u/2XFRlUlZzvfmlbaK0+/U9z/b3ku4bvw7awErbCHMYBwM4H4Vq/GBpL79jjw9fa3812qrtZvvfeI/9Brk9D/aU+FXjjwbYeGfjhpcl3caWoEc0X8WO5Oc815B+0H8fLf4qLaeHPDFsbHRNPAEUZ4LHpyAemK7+JeJ8rVPH4+hiOd4qMYqGt01a/N0Vuh053nmA5cXi6VVSdeKSjZ3i/PTptufN2m2UmoahDZxDLSuqgD3OK/Zbwbo3/CPeFdP0Uj5raBI2+oHNfn5+zN8OJPEfikeJdQTNpYkEZHDP2H9a/Smv1j6M3CNTCZfUzKurOq9P8K6/Nn6D4KcPzw+Enjaqs56L0X+YUUUV/Tx+3n/0f14opdkn92jZJ/dr/Hj6pV/lf3H+dfsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2Sf3aPqlX+V/cHsp9hKKXZJ/do2P/dNH1Sp/L+Aeyn2EoqWG3ubh/Lt42Zj2AzXaaT8NPHetOEsdLnYH+IoQv54rvwXD+OxM+TD0pSfkmzswuVYqu7Uabl6K5wRI7k0KN/ypkk9u9fUnh39lLx5qbrLq7x2SN3JDnH0BzX034H/AGavBHhZ0vdSB1C5XnMn3AR3C9RX67wv9HriDHyTxFP2UO8rX+6599knhBm+LletD2ce7/yPiL4efBTxf4+uUe1gaC0J+aZxgY9vU1+kHw5+F/h34caZ9l0tA87DEkxHzMf6D2r0WGCG2iEMChEXoFGBUtf2L4eeEWWcPR56S5qnWT3+XZH9F8I+HmByiN6a5p/zP9F0EwPSloor9X0PvzwD45fBy2+I+kG/08BNSthmM9N4H8J9f/r1+Yus6PqOgag+l6tC0U8Z2sG7V+3NeW/ET4SeFPiLZlNTiEdyBhJ0HzD61/Ofi/4GUs7m8wy+0a/VdJf8HzPxrxC8LYZk5YvBvlq9e0v+CfkQOn+NLgCvojxj+zT4+8NSvJpkf9oW4Jw0f3v++Rk14dqPh/XdIYpqtpLAw4w6Efzr+JM94IzbLpuGNw8o/LT71ofzVmnDGYYKVsTScfO2n37GQOOBSYHWnbX7A0bJP7tfPLC1bfC/uPF9lPsIQD1oIzwaXZJ/do2Sf3af1Wr2f3C9hLsNwKWl2Sf3aNkn92l9Tqfyv7h+yn2EwKTAp2yT+7RsfuKf1Sr2f3C9hLsNwOlL06U4JIxwqk5rrdH8A+MfEEix6Tp08u7+IIdv5114LJMZiZezoUpSfZJnTh8ur1ZctKDb8kceSo+90r0n4bfDTX/iJrCWGnxkQAgySn7qr3/+tXv3w+/ZU1i9uUv/ABtILeFTnykwWI+vOPyr7j8OeGtF8Laaml6JAtvCgAwo5PufU1/SXhl9HfF4mrHFZ3HkprXl+0/XsvxP2ngnwgxFaoq+aJxivs9X6+RT8G+EtK8EeH4NB0tdqxDlgOWPcn6murpMUtf3DhcNTo040qUbRWiS2sf07QoxpwVOCskrIKKKK6DY/9L+yL/hFfDP/Phb/wDfpP8ACj/hFfDP/Phb/wDfpP8ACt6iuX6jR/kRh9Uo/wAiMH/hFfDP/Phb/wDfpP8ACj/hFfDP/Phb/wDfpP8ACt6ij6jR/kQfVKP8iMH/AIRXwz/z4W//AH6T/Cj/AIRXwz/z4W//AH6T/Ct6ij6jR/kQfVKP8iMH/hFfDP8Az4W//fpP8KP+EV8M/wDPhb/9+k/wreoo+o0f5EH1Sj/IjB/4RXwz/wA+Fv8A9+k/wo/4RXwz/wA+Fv8A9+k/wreoo+o0f5EH1Sj/ACIwf+EV8M/8+Fv/AN+k/wAKP+EV8M/8+Fv/AN+k/wAK3qKPqNH+RB9Uo/yIwf8AhFfDP/Phb/8AfpP8KP8AhFfDP/Phb/8AfpP8K3qKPqNH+RB9Uo/yIwf+EV8M/wDPhb/9+k/wo/4RXwz/AM+Fv/36T/Ct6ij6jR/kQfVKP8iMH/hFfDP/AD4W/wD36T/Cj/hFfDP/AD4W/wD36T/Ct6ij6jR/kQfVKP8AIjB/4RXwz/z4W/8A36T/AAo/4RXwz/z4W/8A36T/AAreoo+o0f5EH1Sj/IjB/wCEV8M/8+Fv/wB+k/wo/wCEV8M/8+Fv/wB+k/wreoo+o0f5EH1Sj/IjB/4RXwz/AM+Fv/36T/Cj/hFfDP8Az4W//fpP8K3qKPqNH+RB9Uo/yIwf+EV8M/8APhb/APfpP8KP+EV8M/8APhb/APfpP8K3qKPqNH+RB9Uo/wAiMH/hFfDP/Phb/wDfpP8ACj/hFfDP/Phb/wDfpP8ACt6ij6jR/kQfVKP8iMH/AIRXwz/z4W//AH6T/Cj/AIRXwz/z4W//AH6T/Ct6ij6jR/kQfVKP8iMH/hFfDP8Az4W//fpP8KP+EV8M/wDPhb/9+k/wreoo+o0f5EH1Sj/IjB/4RXwz/wA+Fv8A9+k/wo/4RXwz/wA+Fv8A9+k/wreoo+o0f5EH1Sj/ACIwf+EV8M/8+Fv/AN+k/wAKP+EV8M/8+Fv/AN+k/wAK3qKPqNH+RB9Uo/yIwf8AhFfDP/Phb/8AfpP8KP8AhFfDP/Phb/8AfpP8K3qKPqNH+RB9Uo/yIwf+EV8M/wDPhb/9+k/wo/4RXwz/AM+Fv/36T/Ct6ij6jR/kQfVKP8iMH/hFfDP/AD4W/wD36T/Cj/hFfDP/AD4W/wD36T/Ct6ij6jR/kQfVKP8AIjB/4RXwz/z4W/8A36T/AAo/4RXwz/z4W/8A36T/AAreoo+o0f5EH1Sj/IjB/wCEV8M/8+Fv/wB+k/wo/wCEV8M/8+Fv/wB+k/wreoo+o0f5EH1Sj/IjB/4RXwz/AM+Fv/36T/Cj/hFfDP8Az4W//fpP8K3qKPqNH+RB9Uo/yIwf+EV8M/8APhb/APfpP8KP+EV8M/8APhb/APfpP8K3qKPqNH+RB9Uo/wAiMH/hFfDP/Phb/wDfpP8ACj/hFfDP/Phb/wDfpP8ACt6ij6jR/kQfVKP8iMH/AIRXwz/z4W//AH6T/Cj/AIRXwz/z4W//AH6T/Ct6ij6jR/kQfVKP8iMH/hFfDP8Az4W//fpP8KP+EV8M/wDPhb/9+k/wreoo+o0f5EH1Sj/IjB/4RXwz/wA+Fv8A9+k/wo/4RXwz/wA+Fv8A9+k/wreoo+o0f5EH1Sj/ACIwf+EV8M/8+Fv/AN+k/wAKP+EV8M/8+Fv/AN+k/wAK3qKPqNH+RB9Uo/yIwf8AhFfDP/Phb/8AfpP8KP8AhFfDP/Phb/8AfpP8K3qKPqNH+RB9Uo/yIwf+EV8M/wDPhb/9+k/wo/4RXwz/AM+Fv/36T/Ct6ij6jR/kQfVKP8iMH/hFfDP/AD4W/wD36T/Cj/hFfDP/AD4W/wD36T/Ct6ij6jR/kQfVKP8AIjB/4RXwz/z4W/8A36T/AAo/4RXwz/z4W/8A36T/AAreoo+o0f5EH1Sj/IjB/wCEV8M/8+Fv/wB+k/wo/wCEV8M/8+Fv/wB+k/wreoo+o0f5EH1Sj/IjB/4RXwz/AM+Fv/36T/Cj/hFfDP8Az4W//fpP8K3qKPqNH+RB9Uo/yIwf+EV8M/8APhb/APfpP8KP+EV8M/8APhb/APfpP8K3qKPqNH+RB9Uo/wAiMH/hFfDP/Phb/wDfpP8ACk/4RXwz/wA+Fv8A9+k/wrfopPAUH9hB9Vo/yox18PaBCcxWUA9xEoP8q1Ioo4BtgAQegGBUlFb06MIfCrFRoQXwqwZ9eaOnSiitLGoUUUUAFFFFABR9KKKfqNOwdKoXOlaXeNuu7aKUnu6K38xV+ioqU4yVpK5nKlFqzWhhN4W8NE5+wW5/7ZJ/hSf8Ir4Z/wCfC3/79J/hW9RXN9Ro/wAiM/qtH+VGD/wivhn/AJ8Lf/v0n+FH/CK+Gf8Anwt/+/Sf4VvUU/qNH+RB9Uo/yIwf+EV8M/8APhb/APfpP8KP+EV8M/8APhb/APfpP8K3qKPqNH+RB9Uo/wAiMH/hFfDP/Phb/wDfpP8ACg+FfDPawt/+/Sf4VvUUfUaH8iD6pR/kRhp4Y8Op92wtx/2yT/CtS3tLW1UraxpGPRVA/lViitKeHpwd4RsaRpQj8KsH1ooordsqMUtgooopDCiiigD/0/7QKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/U/tAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9X+0CiiigAoooppXAKKKKm62uDCiiimAUUUUAFFFFABRRRQAUUUUAFFFFAeYUUUU2gTCiiikAUUUUAFFFFABRRRQAUUUHihh5hRRRQOwUUUUCCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//W/tAooo5oBsKRiFUse1fNPxo/ag8BfCHdp87fbdSxxbxkHB7biDxX5hfEn9r74seOZ3itL7+ybI8CO3O18ehYYzX71wD9HfPc9jGvJKlSfWXX0S1f4H82eJf0o+HeHJSw8Ze2qrTli1p6t6L8T9wJNc0SHInvIUx1zIn+NVv+Eo8MD/mIW4/7aJ/jX82l/wCINa1OUzXt3LMx53M5JPvWabi66mVzn/aNfvND6G9CydTGu/8AgX+Z/OGK+njiea1PAK3+N/oj+l3/AISjwx/0Ebf/AL+J/jR/wlHhj/oI2/8A38T/ABr+aL7Tcf8APR/++jR9puP+ej/99Guj/iTfDf8AQc//AABf5mH/ABPhjP8AoXx/8Dl/kf0u/wDCUeGP+gjb/wDfxP8AGj/hKPDH/QRt/wDv4n+NfzRfabj/AJ6P/wB9Gj7Tcf8APR/++jR/xJvhv+g5/wDgC/zD/ifDGf8AQvj/AOBy/wAj+l3/AISjwx/0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/wBav3Ooo/4mz4l/lh/4D/wQ/wCJL+E+9T/wP/gH4Y/8MYfHT/n0h/77/wDrUf8ADGHx0/59If8Avv8A+tX7nUUf8TZ8S/yw/wDAf+CH/El/Cfep/wCB/wDAPwx/4Yw+On/PpD/33/8AWo/4Yw+On/PpD/33/wDWr9zqKP8AibPiX+WH/gP/AAQ/4kv4T71P/A/+Afhj/wAMYfHT/n0h/wC+/wD61H/DGHx0/wCfSH/vv/61fudRR/xNnxL/ACw/8B/4If8AEl/Cfep/4H/wD8Mf+GMPjp/z6Q/99/8A1qP+GMPjp/z6Q/8Aff8A9av3Ooo/4mz4l/lh/wCA/wDBD/iS/hPvU/8AA/8AgH4Y/wDDGHx0/wCfSH/vv/61H/DGHx0/59If++//AK1fudRR/wATZ8S/yw/8B/4If8SX8J96n/gf/AP/1P7QKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/V/tAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9b+0Civ5D7z/gtd+2NLP/on9mxp2DWiH/2aq7/8Fqf20wcB9K/8A0/+Kr8Ul485Le1pfh/mf6iw/ZJeJzSvUw6/7iP/AORP6+KK/kF/4fVftqf39K/8A0/+Ko/4fVftqf39K/8AANP/AIql/wAR4yXtL7l/mX/xSP8AE3/n7h//AAa//kT+vqiv5Bf+H1X7an9/Sv8A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+NH/AA5t+JP/AEN1h/35k/xr+hGigD+e7/hzb8Sf+husP+/Mn+NH/Dm34k/9DdYf9+ZP8a/oRooA/nu/4c2/En/obrD/AL8yf40f8ObfiT/0N1h/35k/xr+hGigD+e7/AIc2/En/AKG6w/78yf40f8ObfiT/ANDdYf8AfmT/ABr+hGigD+e7/hzb8Sf+husP+/Mn+NH/AA5t+JP/AEN1h/35k/xr+hGigD+e7/hzb8Sf+husP+/Mn+NH/Dm34k/9DdYf9+ZP8a/oRooA/nu/4c2/En/obrD/AL8yf40f8ObfiT/0N1h/35k/xr+hGigD+e7/AIc2/En/AKG6w/78yf40f8ObfiT/ANDdYf8AfmT/ABr+hGigD+e7/hzb8Sf+husP+/Mn+Naenf8ABGrxt5wbVPGFmI+6pBJu/PNfv9RQB+MXhv8A4I6/D+F0bxT4iupgPvfZ8Ln6bga+uPhj/wAE8P2aPhldx6hBpP8AalzFgpLeHcykd8DA/SvuWigCjp+madpNstlpcEdvCoACRKEUYGOgxV6iigAooooAKKKKACiiigAooooAKKKKAP/Q/tAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9H+0CiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/0v7QKK8u/wCFw+Cf+ez/APfB/wAKP+Fw+Cf+ez/98H/CvzT/AIjTwn/0MKX/AIGv8j7z/iG2e/8AQLP/AMBPUaK8u/4XD4J/57P/AN8H/Cj/AIXD4J/57P8A98H/AAo/4jTwn/0MKX/ga/yD/iG2e/8AQLP/AMBPUaK8u/4XD4J/57P/AN8H/Cj/AIXD4J/57P8A98H/AAo/4jTwn/0MKX/ga/yD/iG2e/8AQLP/AMBPUaK8u/4XD4J/57P/AN8H/Cj/AIXD4J/57P8A98H/AAo/4jTwn/0MKX/ga/yD/iG2e/8AQLP/AMBPUaK8u/4XD4J/57P/AN8H/CnD4weCD/y2f/vg/wCFH/EaeE/+hhS/8DX+Qf8AEN89/wCgWf8A4Cen0V5j/wALe8Ef89n/AO+D/hXLeKP2l/gz4ItkvfF2tQ6ZFK2xHuW8oM3oC2M1vh/GDhetNU6WOptvopJ/oEfDbPZOyws//AT3eivJbD43fDvVLOPUNOvTcQSjckiAsrA9CCOoq2fi/wCCAM+c/wD3wf8ACsp+M/CkXyyx9NP/ABL/ACB+G+e7fVZ/+Anp9FeXf8Lh8E/89n/74P8AhR/wuHwT/wA9n/74P+FT/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/kH/ENs9/6BZ/+AnqNFeXf8Lh8E/8APZ/++D/hR/wuHwT/AM9n/wC+D/hR/wARp4T/AOhhS/8AA1/k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",
    imageUrl:"IMG_1746.jpeg",
    content:"OBJECTIFS TENSIONNELS (valeurs en mmHg)\n\nNEUROLOGIE\n- AVC ischemique + thrombolyse : PAS <= 185 / PAM <= 110\n- AVC hemorragique : PAS <= 140 / PAM <= 110\n- AVC ischemique sans thrombolyse : PAS <= 220 / PAM <= 120\n\nTRAUMA\n- Trauma severe / Hemorragie : PAS >= 80-90 / PAM >= 50-60\n- TC grave / Trauma medullaire : PAS >= 110 / PAM >= 80\n\nOBSTETRIQUE\n- Pre-eclampsie / Eclampsie : PAS <= 160 / PAM <= 110\n\nVASCULAIRE\n- Dissection aortique : PAS > 80 ET PAS < 120\n\nCARDIAQUE\n- OAP hypertensif : PAS <= 110\n\nSource : SMUR BMPM / Infographie Dr Pierre BALAZ"
  }
];


const DILUTIONS = [];


// - helpers -
function Tag({label, color}) {
  const C = useC();
  return (
    <span style={{background:(color||C.blue)+"22", color:(color||C.blue), padding:"2px 10px", borderRadius:20, fontSize:11, fontWeight:700, letterSpacing:.3}}>
      {label}
    </span>
  );
}

function Card({children, onClick, style={}}) {
  const C = useC();
  return (
    <div onClick={onClick} style={{background:C.card, borderRadius:14, padding:16, boxShadow:"0 2px 12px rgba(26,58,92,.07)", border:`1px solid ${C.border}`, cursor:onClick?"pointer":"default", animation:"fadeIn .2s ease", ...style}}>
      {children}
    </div>
  );
}

function Btn({children, onClick, color, outline, style={}}) {
  const C = useC();
  return (
    <button onClick={onClick} style={{
      background: outline ? "transparent" : (color||C.blue),
      color: outline ? (color||C.blue) : "#fff",
      border: outline ? `2px solid ${color||C.blue}` : "none",
      borderRadius:10, padding:"10px 18px", fontWeight:700, fontSize:13, cursor:"pointer",
      transition:"opacity .15s, transform .1s", WebkitTapHighlightColor:"transparent", ...style
    }}>{children}</button>
  );
}

function BackBtn({onClick}) {
  const C = useC();
  return (
    <button onClick={onClick} style={{background:"none", border:"none", color:C.sub, fontWeight:700, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", gap:6, marginBottom:16}}>
      « Retour
    </button>
  );
}

// ── Notifications hook ────────────────────────────────────────────────────────
const NOTIF_KEY = "app_notifications";

function useNotifications() {
  const [notifs, setNotifs] = useState([]);

  useEffect(()=>{
    (async()=>{
      try { const r = await safeGet(NOTIF_KEY); if(r) setNotifs(JSON.parse(r.value)); } catch(e){}
    })();
  },[]);

  async function pushNotif(item) {
    // item : { id, title, icon, nav, type }
    const notif = { ...item, key: Date.now() + "_" + item.id, ts: Date.now() };
    setNotifs(prev => {
      const next = [notif, ...prev].slice(0, 50); // max 50
      safeSet(NOTIF_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function clearAll() {
    setNotifs([]);
    try { await safeSet(NOTIF_KEY, "[]"); } catch(e){}
  }

  return { notifs, pushNotif, clearAll };
}

// ── Panneau notifications ─────────────────────────────────────────────────────
function NotifPanel({ notifs, onNav, onClear, onClose, theme }) {
  const C = theme;
  const typeLabels = { ecg:"ECG", imagerie:"Imagerie", retex:"RETEX",
    divers:"Divers", agenda:"Agenda", gestes:"Geste urgent", dilutions:"Dilution" };

  function relTime(ts) {
    const d = Math.floor((Date.now()-ts)/1000);
    if(d<60) return "À l'instant";
    if(d<3600) return `Il y a ${Math.floor(d/60)} min`;
    if(d<86400) return `Il y a ${Math.floor(d/3600)} h`;
    return `Il y a ${Math.floor(d/86400)} j`;
  }

  return (
    <div style={{position:"absolute", top:52, right:0, width:"min(360px,100vw)", zIndex:2000,
      background:C.card, borderRadius:16, boxShadow:"0 8px 32px rgba(0,0,0,.25)",
      border:`1px solid ${C.border}`, overflow:"hidden", animation:"fadeIn .15s ease"}}>

      {/* Header */}
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"12px 16px", borderBottom:`1px solid ${C.border}`, background:C.navy}}>
        <div style={{color:"#fff", fontWeight:800, fontSize:13}}>🔔 Notifications</div>
        <div style={{display:"flex", gap:8}}>
          {notifs.length>0 && (
            <button onClick={onClear} style={{background:"rgba(255,255,255,.15)", border:"none",
              borderRadius:8, padding:"3px 10px", color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer"}}>
              Tout effacer
            </button>
          )}
          <button onClick={onClose} style={{background:"rgba(255,255,255,.15)", border:"none",
            borderRadius:8, width:26, height:26, color:"#fff", fontSize:16, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center"}}>✕</button>
        </div>
      </div>

      {/* Liste */}
      <div style={{maxHeight:320, overflowY:"auto"}}>
        {notifs.length===0 ? (
          <div style={{textAlign:"center", padding:"32px 20px", color:C.sub}}>
            <div style={{fontSize:36, marginBottom:8}}>🔕</div>
            <div style={{fontSize:13, fontWeight:600}}>Aucune notification</div>
          </div>
        ) : notifs.map(n => (
          <button key={n.key} onClick={()=>{ onNav(n.nav, {id:n.id}); onClose(); }}
            style={{width:"100%", background:"none", border:"none", borderBottom:`1px solid ${C.border}`,
              padding:"11px 16px", cursor:"pointer", textAlign:"left", display:"flex", gap:12, alignItems:"center"}}>
            <div style={{background:(n.color||"#2E7EAD")+"22", borderRadius:10,
              width:38, height:38, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20}}>
              {n.icon}
            </div>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontSize:12, fontWeight:800, color:n.color||C.blue, marginBottom:2}}>
                {typeLabels[n.nav]||n.nav}
              </div>
              <div style={{fontSize:13, fontWeight:600, color:C.text,
                whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>
                {n.title}
              </div>
              <div style={{fontSize:10, color:C.sub, marginTop:2}}>{relTime(n.ts)}</div>
            </div>
            <span style={{color:C.sub, fontSize:16, flexShrink:0}}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Favoris hook ─────────────────────────────────────────────────────────────
// ── Store favoris global ──────────────────────────────────────────────────────
// Stocké sur window pour survivre aux re-renders du module JSX
if(!window._fav) window._fav = { cache: null, listeners: new Set() };

function useFavoris() {
  const [favoris, setFavoris] = useState(window._fav.cache || []);

  useEffect(()=>{
    const fav = window._fav;
    if(fav.cache === null) {
      // Premier chargement depuis storage
      (async()=>{
        try {
          const r = await safeGet("favoris");
          fav.cache = r ? JSON.parse(r.value) : [];
        } catch(e) {
          fav.cache = [];
        }
        const snap = [...fav.cache];
        setFavoris(snap);
        fav.listeners.forEach(fn => fn(snap));
      })();
    } else {
      setFavoris([...fav.cache]);
    }
    const handler = (list) => setFavoris(list);
    fav.listeners.add(handler);
    return () => fav.listeners.delete(handler);
  },[]);

  function toggleFavori(item) {
    const fav = window._fav;
    if(fav.cache === null) fav.cache = [];
    const key = item.type + "_" + item.id;
    const exists = fav.cache.find(f => f.key === key);
    fav.cache = exists
      ? fav.cache.filter(f => f.key !== key)
      : [...fav.cache, {...item, key}];
    const snap = [...fav.cache];
    fav.listeners.forEach(fn => fn(snap));
    safeSet("favoris", JSON.stringify(fav.cache));
  }

  function isFavori(type, id) {
    const cache = window._fav.cache || [];
    return cache.some(f => f.key === type + "_" + id);
  }

  return { favoris, toggleFavori, isFavori };
}

// ── StarBtn ───────────────────────────────────────────────────────────────────
function StarBtn({ filled, onToggle, color }) {
  const C = useC();
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(); }}
      style={{
        background: filled ? (color||"#F59E0B")+"22" : "rgba(255,255,255,.12)",
        border: `1.5px solid ${filled ? (color||"#F59E0B") : "rgba(255,255,255,.25)"}`,
        borderRadius: 10, width: 36, height: 36,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", fontSize: 18, flexShrink: 0,
        transition: "all .15s",
      }}
      title={filled ? "Retirer des favoris" : "Ajouter aux favoris"}
    >
      {filled ? "★" : "☆"}
    </button>
  );
}

// ── MediaUploader : upload multiple photos/videos ──────────────────────────
function MediaUploader({ medias, onChange, accept="image/*,video/*", label="Photos / Vidéos" }) {
  const C = useC();
  const fileRef = useRef(null);

  function addFiles(files) {
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const newItem = { url: file.name + "_" + Date.now(), name: file.name, data: ev.target.result, isVideo: file.type.startsWith("video/"), credit: "" };
        onChange(prev => [...prev, newItem]);
      };
      reader.readAsDataURL(file);
    });
  }

  function remove(idx) {
    onChange(prev => prev.filter((_,i) => i !== idx));
  }

  function updateCredit(idx, val) {
    onChange(prev => prev.map((m,i) => i===idx ? {...m, credit:val} : m));
  }

  return (
    <div style={{marginBottom:12}}>
      <div style={{fontSize:11, fontWeight:700, color:"#64748B", marginBottom:6, display:"block"}}>{label}</div>

      {/* Grille des médias déjà ajoutés */}
      {medias.length > 0 && (
        <div style={{display:"flex", flexDirection:"column", gap:8, marginBottom:8}}>
          {medias.map((m, i) => (
            <div key={i} style={{borderRadius:10, overflow:"hidden", background:"#0A1628"}}>
              {/* Aperçu image en entier */}
              <div style={{position:"relative", background:"#0A1628", display:"flex", alignItems:"center", justifyContent:"center", minHeight:120, maxHeight:220}}>
                {m.isVideo
                  ? <video src={m.data} controls style={{width:"100%", maxHeight:220, display:"block"}}/>
                  : <img src={m.data} alt={m.name} style={{width:"100%", maxHeight:220, objectFit:"contain", display:"block"}}/>
                }
                {/* Badge type */}
                <div style={{position:"absolute", top:6, left:6, background:"rgba(0,0,0,.6)", borderRadius:4, padding:"2px 6px", fontSize:10, color:"#fff", fontWeight:700}}>
                  {m.isVideo ? "🎬 Vidéo" : "📷 Photo"}
                </div>
                {/* Bouton suppr */}
                <button onClick={()=>remove(i)} style={{position:"absolute", top:5, right:5, background:"rgba(220,38,38,.85)", border:"none", borderRadius:"50%", width:24, height:24, cursor:"pointer", color:"#fff", fontSize:14, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center", padding:0}}>
                  ✕
                </button>
              </div>
              {/* Champ crédit */}
              <div style={{background:"#1A2B3C", padding:"6px 10px"}}>
                <input
                  value={m.credit||""}
                  onChange={e=>updateCredit(i, e.target.value)}
                  placeholder="© Crédit photo / source (optionnel)"
                  style={{width:"100%", background:"transparent", border:"none", outline:"none", fontSize:11, color:"rgba(255,255,255,.7)", fontStyle:"italic", boxSizing:"border-box"}}
                />
              </div>
            </div>
          ))}
          {/* Bouton ajouter supplémentaire */}
          <button onClick={()=>fileRef.current?.click()} style={{borderRadius:10, border:`2px dashed #CBD5E1`, background:"#F8FAFC", cursor:"pointer", padding:"10px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3, color:"#94A3B8"}}>
            <span style={{fontSize:22}}>+</span>
            <span style={{fontSize:9, fontWeight:700}}>Ajouter un autre fichier</span>
          </button>
        </div>
      )}

      {/* Bouton principal si vide */}
      {medias.length === 0 && (
        <button onClick={()=>fileRef.current?.click()} style={{width:"100%", display:"flex", alignItems:"center", gap:10, background:"#F0F4F8", border:`2px dashed #CBD5E1`, borderRadius:10, padding:"12px 14px", cursor:"pointer", marginBottom:4}}>
          <span style={{fontSize:24}}>📎</span>
          <div style={{textAlign:"left"}}>
            <div style={{fontSize:12, fontWeight:700, color:"#1A3A5C"}}>Ajouter des photos / vidéos</div>
            <div style={{fontSize:10, color:"#64748B"}}>JPG, PNG, GIF, MP4 — plusieurs fichiers acceptés</div>
          </div>
        </button>
      )}

      <input ref={fileRef} type="file" accept={accept} multiple style={{display:"none"}}
        onChange={e=>{ addFiles(e.target.files); e.target.value=""; }}/>
    </div>
  );
}

// ── ImageLightbox : visionneuse plein écran avec zoom ───────────────────────
function ImageLightbox({ src, credit, onClose }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({x:0, y:0});
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({x:0, y:0, px:0, py:0});
  const lastTouchDist = useRef(null);
  const imgRef = useRef(null);

  // Fermer avec Échap
  useEffect(()=>{
    const h = e => { if(e.key==="Escape") onClose(); };
    window.addEventListener("keydown", h);
    return ()=>window.removeEventListener("keydown", h);
  },[onClose]);

  // Zoom molette
  function onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.15 : 0.87;
    setScale(s => Math.min(Math.max(s*delta, 1), 6));
  }

  // Drag souris
  function onMouseDown(e) {
    if(scale<=1) return;
    setDragging(true);
    setDragStart({x:e.clientX, y:e.clientY, px:pos.x, py:pos.y});
  }
  function onMouseMove(e) {
    if(!dragging) return;
    setPos({x: dragStart.px+(e.clientX-dragStart.x), y: dragStart.py+(e.clientY-dragStart.y)});
  }
  function onMouseUp() { setDragging(false); }

  // Touch pinch zoom
  function onTouchStart(e) {
    if(e.touches.length===2) {
      const dx = e.touches[0].clientX-e.touches[1].clientX;
      const dy = e.touches[0].clientY-e.touches[1].clientY;
      lastTouchDist.current = Math.sqrt(dx*dx+dy*dy);
    } else if(e.touches.length===1 && scale>1) {
      setDragging(true);
      setDragStart({x:e.touches[0].clientX, y:e.touches[0].clientY, px:pos.x, py:pos.y});
    }
  }
  function onTouchMove(e) {
    if(e.touches.length===2 && lastTouchDist.current) {
      const dx = e.touches[0].clientX-e.touches[1].clientX;
      const dy = e.touches[0].clientY-e.touches[1].clientY;
      const dist = Math.sqrt(dx*dx+dy*dy);
      const ratio = dist/lastTouchDist.current;
      lastTouchDist.current = dist;
      setScale(s=>Math.min(Math.max(s*ratio, 1), 6));
    } else if(e.touches.length===1 && dragging) {
      setPos({x: dragStart.px+(e.touches[0].clientX-dragStart.x), y: dragStart.py+(e.touches[0].clientY-dragStart.y)});
    }
  }
  function onTouchEnd() { setDragging(false); lastTouchDist.current=null; }

  // Reset zoom
  function resetZoom() { setScale(1); setPos({x:0,y:0}); }

  function handleBgClick(e) {
    if(e.target===e.currentTarget) onClose();
  }

  return (
    <div onClick={handleBgClick}
      style={{position:"fixed", inset:0, background:"rgba(0,0,0,.95)", zIndex:9999,
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        touchAction:"none", userSelect:"none"}}
      onWheel={onWheel}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Bouton fermer */}
      <button onClick={onClose} style={{position:"absolute", top:16, right:16, background:"rgba(255,255,255,.18)", border:"none", borderRadius:"50%", width:40, height:40, color:"#fff", fontSize:22, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1}}>✕</button>

      {/* Indicateur zoom */}
      {scale>1 && (
        <div style={{position:"absolute", top:16, left:16, background:"rgba(0,0,0,.6)", borderRadius:8, padding:"4px 10px", color:"#fff", fontSize:11, fontWeight:700, zIndex:1}}>
          {Math.round(scale*100)}%
          <button onClick={resetZoom} style={{marginLeft:8, background:"rgba(255,255,255,.2)", border:"none", borderRadius:4, color:"#fff", fontSize:10, cursor:"pointer", padding:"1px 6px"}}>Reset</button>
        </div>
      )}

      {/* Image */}
      <div onMouseDown={onMouseDown}
        style={{cursor: scale>1 ? (dragging?"grabbing":"grab") : "zoom-in", display:"flex", alignItems:"center", justifyContent:"center", width:"100%", height:"100%", overflow:"hidden"}}>
        <img ref={imgRef} src={src} alt=""
          style={{
            maxWidth:"100%", maxHeight:"90vh",
            objectFit:"contain",
            transform:`scale(${scale}) translate(${pos.x/scale}px,${pos.y/scale}px)`,
            transition: dragging ? "none" : "transform .15s ease",
            borderRadius: scale<=1 ? 12 : 0,
            pointerEvents:"none",
          }}
          onDoubleClick={()=>{ if(scale<=1) setScale(2.5); else resetZoom(); }}
        />
      </div>

      {/* Légende crédit */}
      {credit && <div style={{position:"absolute", bottom:20, color:"rgba(255,255,255,.55)", fontSize:11, fontStyle:"italic"}}>© {credit}</div>}

      {/* Aide */}
      {scale===1 && <div style={{position:"absolute", bottom:20, color:"rgba(255,255,255,.35)", fontSize:10}}>Double-clic ou pinch pour zoomer • Molette souris • Clic hors image pour fermer</div>}
    </div>
  );
}

// ── MediaGallery : affichage d'une liste de médias (vue détail) ─────────────
function MediaGallery({ medias }) {
  const C = useC();
  const [lightbox, setLightbox] = useState(null);
  if(!medias || medias.length===0) return null;
  return (
    <div style={{marginBottom:16}}>
      <div style={{display:"flex", flexDirection:"column", gap:10}}>
        {medias.map((m,i)=>(
          <div key={i} style={{borderRadius:10, overflow:"hidden", background:"#0A1628"}}>
            {/* Aperçu complet */}
            <div onClick={()=>!m.isVideo && setLightbox(m)}
              style={{cursor:m.isVideo?"default":"pointer", position:"relative", display:"flex", alignItems:"center", justifyContent:"center", background:"#0A1628", minHeight:80}}>
              {m.isVideo
                ? <video src={m.data} controls style={{width:"100%", display:"block"}}/>
                : <img src={m.data} alt={m.name||""} style={{width:"100%", objectFit:"contain", display:"block"}}/>
              }
              {!m.isVideo && (
                <div style={{position:"absolute", bottom:6, right:8, background:"rgba(0,0,0,.55)", borderRadius:6, padding:"3px 8px", fontSize:10, color:"#fff", display:"flex", alignItems:"center", gap:4}}>
                  <span>🔍</span><span>Zoom</span>
                </div>
              )}
            </div>
            {/* Crédit si présent */}
            {m.credit && (
              <div style={{background:"#1A2B3C", padding:"4px 10px", fontSize:10, color:"rgba(255,255,255,.55)", fontStyle:"italic"}}>
                © {m.credit}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Lightbox avec zoom */}
      {lightbox && <ImageLightbox src={lightbox.data} credit={lightbox.credit} onClose={()=>setLightbox(null)}/>}
    </div>
  );
}

// - Recherche globale -
function useGlobalSearch() {
  const [allData, setAllData] = useState(null);
  useEffect(()=>{
    (async()=>{
      const base = {
        ecgs: ECGS,
        retex: [],
        divers: DIVERS,
        agenda: AGENDA,
        annuaire: [],
        imagerie: [],
        dilutions: DILUTIONS,
        gestes: GESTES,
      };
      try { const r=await safeGet("admin_ecgs");     if(r) base.ecgs=[...ECGS,...JSON.parse(r.value)]; } catch(e){}
      try { const r=await safeGet("retex_submissions"); if(r) base.retex=JSON.parse(r.value); } catch(e){}
      try { const r=await safeGet("admin_divers");   if(r) base.divers=[...DIVERS,...JSON.parse(r.value)]; } catch(e){}
      try { const r=await safeGet("admin_agenda");   if(r) base.agenda=[...AGENDA,...JSON.parse(r.value)]; } catch(e){}
      try { const r=await safeGet("admin_imagerie");    if(r) base.imagerie=JSON.parse(r.value); } catch(e){}
      try { const r=await safeGet("admin_dilutions"); if(r) base.dilutions=[...DILUTIONS,...JSON.parse(r.value)]; } catch(e){}
      try { const r=await safeGet("admin_contacts"); if(r) base.annuaire=JSON.parse(r.value); } catch(e){}
      setAllData(base);
    })();
  },[]);
  return allData;
}

function GlobalSearch({query, allData, onNav, onClose}) {
  const C = useC();
  if(!query.trim() || !allData) return null;
  const q = query.toLowerCase().trim();

  const results = [];

  // ECG
  allData.ecgs.forEach(e=>{
    if((e.title+(e.context||"")+(e.diagnosis||"")).toLowerCase().includes(q))
      results.push({type:"ecg", icon:"❤️", color:C.red, bg:C.redLight,
        title:e.title, sub:e.diagnosis||"ECG", nav:"ecg"});
  });

  // RETEX
  allData.retex.forEach(r=>{
    const hay=[r.title,r.author,r.lieu,r.contexte,r.situation,r.bien,r.recit,r.takehome].filter(Boolean).join(" ");
    if(hay.toLowerCase().includes(q))
      results.push({type:"retex", icon:"🔬", color:C.green, bg:C.greenLight,
        title:r.title, sub:(r.author||"")+(r.date?" - "+r.date:""), nav:"retex"});
  });

  // Divers
  allData.divers.forEach(d=>{
    const hay=[d.title,d.content,...(Array.isArray(d.tags)?d.tags:[])].filter(Boolean).join(" ");
    if(hay.toLowerCase().includes(q))
      results.push({type:"divers", icon:"⚡", color:C.navy, bg:C.blueLight,
        title:d.title, sub:(Array.isArray(d.tags)?d.tags:[]).join(" ")||"Base de connaissances", nav:"divers"});
  });

  // Dilutions
  (allData.dilutions||[]).forEach(d=>{
    const hay=[d.title,d.subtitle,...(Array.isArray(d.tags)?d.tags:[])].filter(Boolean).join(" ");
    if(hay.toLowerCase().includes(q))
      results.push({type:"dilution", icon:"💉", color:"#E05260", bg:"#FDF0F1",
        title:d.title, sub:d.subtitle||"Dilution", nav:"dilutions"});
  });

  // Gestes
  (allData.gestes||[]).forEach(g=>{
    const hay=[g.title,(Array.isArray(g.tags)?g.tags:[]).join(" "),g.indications||""].join(" ");
    if(hay.toLowerCase().includes(q))
      results.push({type:"geste", icon:"✂️", color:"#C0392B", bg:"#FDECEA",
        title:g.title, sub:(Array.isArray(g.tags)?g.tags:[]).join(" ")||"Geste technique", nav:"gestes"});
  });

  // Agenda
  allData.agenda.forEach(ev=>{
    if((ev.title+(ev.lieu||"")+(ev.description||"")).toLowerCase().includes(q))
      results.push({type:"agenda", icon:"📅", color:C.amber, bg:C.amberLight,
        title:ev.title, sub:ev.date+(ev.lieu?" — "+ev.lieu:""), nav:"agenda"});
  });

  // Annuaire
  allData.annuaire.forEach(p=>{
    const tels = (p.telephones||[]).map(t=>t.numero).join(" ");
    const tel1 = p.telephones?.[0]?.numero || "";
    if((p.nom+(p.role||"")+(p.categorie||"")+tels).toLowerCase().includes(q))
      results.push({type:"annuaire", icon:"📒", color:"#2E6EA6", bg:"#E8F0FA",
        title:p.nom, sub:(p.role||p.categorie||"")+(tel1?" · "+tel1:""), nav:"annuaire"});
  });

  // Imagerie
  allData.imagerie.forEach(c=>{
    if((c.title+(c.context||"")+(c.type||"")).toLowerCase().includes(q))
      results.push({type:"imagerie", icon:"🖼️", color:"#9B59B6", bg:"#F3E8FF",
        title:c.title, sub:c.type||"Imagerie", nav:"imagerie"});
  });

  return (
    <div style={{position:"absolute", top:"100%", left:0, right:0, zIndex:100,
      background:C.white, borderRadius:"0 0 16px 16px",
      boxShadow:"0 8px 32px rgba(26,58,92,.18)",
      border:`1px solid ${C.border}`, borderTop:"none",
      maxHeight:320, overflowY:"auto"}}>
      {results.length===0 ? (
        <div style={{padding:"20px 16px", textAlign:"center", color:C.sub, fontSize:13}}>
          <div style={{fontSize:28, marginBottom:6}}>{"🔍"}</div>
          Aucun resultat pour <strong>"{query}"</strong>
        </div>
      ) : (
        <div>
          <div style={{padding:"8px 16px 4px", fontSize:10, fontWeight:800, color:C.sub, letterSpacing:.5}}>
            {results.length} RESULTAT{results.length>1?"S":""}
          </div>
          {results.map((r,i)=>(
            <button key={i} onClick={()=>{ onNav(r.nav); onClose(); }}
              style={{width:"100%", background:"none", border:"none", borderTop:`1px solid ${C.border}`,
                padding:"10px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:10,
                textAlign:"left"}}>
              <div style={{background:r.bg, borderRadius:9, width:34, height:34, display:"flex",
                alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0}}>
                {r.icon}
              </div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:13, fontWeight:700, color:C.text,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{r.title}</div>
                <div style={{fontSize:11, color:C.sub,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{r.sub}</div>
              </div>
              <div style={{fontSize:10, fontWeight:700, color:r.color, background:r.bg,
                padding:"2px 7px", borderRadius:6, flexShrink:0, textTransform:"uppercase", letterSpacing:.3}}>
                {r.type}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// - HomeScreen -
function HomeScreen({onNav}) {
  const C = useC();
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const allData = useGlobalSearch();
  const { favoris } = useFavoris();
  const inputRef = useRef(null);
  const searchRef = useRef(null);

  // Fermer en cliquant dehors
  useEffect(()=>{
    function handleClick(e) {
      if(searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return ()=>document.removeEventListener("mousedown", handleClick);
  },[]);

  const shortcuts = [
    {id:"retex",      icon:"🔬", label:"RETEX/cas",         color:C.green,   bg:C.greenLight},
    {id:"ecg",        icon:"❤️", label:"ECG",               color:C.red,     bg:C.redLight},
    {id:"imagerie",   icon:"🖼️", label:"Imagerie",          color:"#9B59B6", bg:"#F3E8FF"},
    {id:"gestes",     icon:"✂️",  label:"Gestes urgents",    color:"#C0392B", bg:"#FDECEA"},
    {id:"dilutions",  icon:"💉", label:"Dilutions",         color:"#E05260", bg:"#FDF0F1"},
    {id:"favoris",    icon:"⭐", label:"Favoris",           color:"#F59E0B", bg:"#FEF7E8"},
    {id:"divers",     icon:"⚡", label:"Divers",            color:C.navy,    bg:C.blueLight},
    
    {id:"agenda",     icon:"📅", label:"Agenda",            color:C.amber,   bg:C.amberLight},
    {id:"annuaire",   icon:"📒", label:"Contacts",          color:C.navy,    bg:C.blueLight},
    {id:"admin",      icon:"🗂️", label:"Éditeur de fiches", color:"#475569", bg:"#F1F5F9"},
  ];

  const isSearching = searchFocused && query.trim().length>0;

  return (
    <div>
      {/* Header */}
      <div style={{background:`linear-gradient(135deg, ${C.navy} 0%, #2E5C8A 100%)`, borderRadius:18, padding:20, marginBottom:20, color:"#fff"}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
          <div style={{display:"flex", alignItems:"center", gap:12}}>
            <div style={{background:"#fff", borderRadius:10, padding:"5px 8px", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0}}>
              <img src={LOGO_HOSP} alt="CH Aubagne" style={{height:56, width:"auto", display:"block"}}/>
            </div>
            <div>
              <div style={{fontSize:20, fontWeight:800}}>SAU / SMUR Aubagne</div>
              <div style={{fontSize:12, opacity:.75}}>CH Edmond Garcin</div>
            </div>
          </div>
          <span style={{background:"rgba(255,255,255,.15)", borderRadius:20, padding:"3px 10px", fontSize:11, fontWeight:700, whiteSpace:"nowrap"}}>
            🩺 Médecin
          </span>
        </div>

      </div>

      {/* Barre de recherche globale */}
      <div ref={searchRef} style={{position:"relative", marginBottom:24}}>
        <div style={{
          display:"flex", alignItems:"center", gap:10,
          background:C.white,
          border:`1.5px solid ${searchFocused ? C.blue : C.border}`,
          borderRadius: isSearching ? "14px 14px 0 0" : 14,
          padding:"11px 14px",
          boxShadow: searchFocused ? `0 0 0 3px ${C.blue}18` : "0 2px 8px rgba(26,58,92,.06)",
          transition:"border-color .15s, box-shadow .15s, border-radius .1s",
        }}>
          <span style={{fontSize:16, opacity:.5, flexShrink:0}}>{"🔍"}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e=>setQuery(e.target.value)}
            onFocus={()=>setSearchFocused(true)}
            placeholder="Rechercher un ECG, contact, RETEX, geste..."
            style={{
              flex:1, border:"none", outline:"none", fontSize:13,
              color:C.text, background:"transparent",
              fontFamily:"inherit",
            }}
          />
          {query.length>0 && (
            <button onClick={()=>{ setQuery(""); inputRef.current?.focus(); }}
              style={{background:"none", border:"none", cursor:"pointer", color:C.sub,
                fontSize:16, lineHeight:1, padding:0, flexShrink:0}}>
              ✕
            </button>
          )}
        </div>

        {/* Résultats */}
        {searchFocused && (
          <GlobalSearch
            query={query}
            allData={allData}
            onNav={onNav}
            onClose={()=>{ setSearchFocused(false); setQuery(""); }}
          />
        )}
      </div>

      {/* Accès rapide — masqué pendant la recherche */}
      {!isSearching && (
        <>
          <div style={{fontSize:13, fontWeight:800, color:C.navy, marginBottom:12, letterSpacing:.5}}>ACCES RAPIDE</div>
          <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:24}}>
            {shortcuts.map(s => (
              <button key={s.id} onClick={()=>onNav(s.id)} style={{background:s.bg, border:"none", borderRadius:12, padding:"12px 4px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:5}}>
                <span style={{fontSize:22}}>{s.icon}</span>
                <span style={{fontSize:9, fontWeight:700, color:s.color, textAlign:"center", lineHeight:1.2}}>{s.label}</span>
              </button>
            ))}
          </div>

          {/* ── Favoris — 3 derniers ── */}
          {favoris.length > 0 && (
            <div style={{marginBottom:20}}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
                <div style={{fontSize:13, fontWeight:800, color:C.navy, letterSpacing:.5}}>⭐ FAVORIS</div>
                {favoris.length > 3 && (
                  <button onClick={()=>onNav("favoris")} style={{background:"none", border:"none", cursor:"pointer", fontSize:11, fontWeight:700, color:C.blue}}>
                    Voir tous ({favoris.length}) →
                  </button>
                )}
              </div>
              <div style={{display:"flex", flexDirection:"column", gap:8}}>
                {favoris.slice(0, 3).map(f => (
                  <button key={f.key} onClick={()=>onNav(f.nav, f)}
                    style={{background:C.white, border:`1px solid ${C.border}`,
                      borderLeft:`4px solid ${f.color}`,
                      borderRadius:14, padding:"12px 14px", cursor:"pointer",
                      textAlign:"left", display:"flex", alignItems:"center", gap:12}}>
                    <div style={{background:f.color+"22", borderRadius:10,
                      width:38, height:38, display:"flex", alignItems:"center",
                      justifyContent:"center", fontSize:20, flexShrink:0}}>
                      {f.icon}
                    </div>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:13, fontWeight:700, color:C.text,
                        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>
                        {f.title}
                      </div>
                      <div style={{fontSize:10, color:C.sub, marginTop:2, textTransform:"capitalize"}}>{f.type}</div>
                    </div>
                    <span style={{color:"#F59E0B", fontSize:16}}>★</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Widget Saviez-vous (RETEX) ── */}
          <SaviezVousWidget onNav={onNav}/>
        </>
      )}
    </div>
  );
}

// ─── ÉCRAN FAVORIS ────────────────────────────────────────────────────────────
function FavorisScreen({ onNav }) {
  const C = useC();
  const { favoris, toggleFavori } = useFavoris();

  const typeLabels = {
    retex:"RETEX / Cas", ecg:"ECG", icono:"Imagerie",
    agenda:"Agenda", divers:"Divers", geste:"Geste urgent", dilution:"Dilution",
  };

  if(favoris.length === 0) return (
    <div style={{textAlign:"center", padding:"60px 20px"}}>
      <div style={{fontSize:52, marginBottom:16}}>⭐</div>
      <div style={{fontSize:16, fontWeight:800, color:C.navy, marginBottom:8}}>Aucun favori</div>
      <div style={{fontSize:13, color:C.sub, lineHeight:1.6}}>
        Ajoutez des favoris en appuyant sur l'étoile ☆ dans chaque fiche pour les retrouver ici rapidement.
      </div>
    </div>
  );

  // Grouper par type
  const groups = {};
  favoris.forEach(f => {
    const label = typeLabels[f.type] || f.type;
    if(!groups[label]) groups[label] = [];
    groups[label].push(f);
  });

  return (
    <div style={{animation:"fadeIn .2s ease"}}>
      {/* Header */}
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20}}>
        <div>
          <h2 style={{color:C.navy, fontWeight:900, fontSize:18, margin:0}}>⭐ Mes favoris</h2>
          <div style={{fontSize:11, color:C.sub, marginTop:2}}>{favoris.length} élément{favoris.length>1?"s":""} sauvegardé{favoris.length>1?"s":""}</div>
        </div>
      </div>

      {/* Par groupe */}
      {Object.entries(groups).map(([label, items]) => (
        <div key={label} style={{marginBottom:20}}>
          <div style={{fontSize:11, fontWeight:800, color:C.sub, letterSpacing:.5, marginBottom:8, textTransform:"uppercase"}}>
            {label} ({items.length})
          </div>
          <div style={{display:"flex", flexDirection:"column", gap:8}}>
            {items.map(f => (
              <div key={f.key} style={{
                background:C.white, border:`1px solid ${C.border}`,
                borderLeft:`4px solid ${f.color}`,
                borderRadius:14, padding:"12px 14px",
                display:"flex", alignItems:"center", gap:12,
                animation:"fadeIn .2s ease",
              }}>
                {/* Icône */}
                <button onClick={()=>onNav(f.nav, f)} style={{
                  background:f.color+"22", borderRadius:10,
                  width:40, height:40, display:"flex", alignItems:"center",
                  justifyContent:"center", fontSize:20, flexShrink:0,
                  border:"none", cursor:"pointer",
                }}>
                  {f.icon}
                </button>
                {/* Titre */}
                <button onClick={()=>onNav(f.nav, f)} style={{
                  flex:1, minWidth:0, background:"none", border:"none",
                  cursor:"pointer", textAlign:"left", padding:0,
                }}>
                  <div style={{fontSize:13, fontWeight:700, color:C.text,
                    whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>
                    {f.title}
                  </div>
                  <div style={{fontSize:10, color:f.color, fontWeight:600, marginTop:2}}>{label}</div>
                </button>
                {/* Bouton retirer */}
                <button onClick={()=>toggleFavori(f)} style={{
                  background:"none", border:"none", cursor:"pointer",
                  fontSize:20, color:"#F59E0B", flexShrink:0, padding:4,
                }} title="Retirer des favoris">★</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SaviezVousWidget({ onNav }) {
  const C = useC();
  const [item, setItem] = useState(null);

  useEffect(()=>{
    (async()=>{
      try {
        const r = await safeGet("retex_submissions");
        if(r) {
          const validated = JSON.parse(r.value).filter(x=>x.takehome);
          if(validated.length>0) {
            const pick = validated[Math.floor(Math.random()*validated.length)];
            setItem(pick);
          }
        }
      } catch(e){}
    })();
  },[]);

  if(!item) return null;

  return (
    <div onClick={()=>onNav("retex")} style={{
      background:`linear-gradient(135deg, #2E9E6B 0%, #27AE60 100%)`,
      borderRadius:16, padding:16, marginBottom:20, cursor:"pointer",
      boxShadow:"0 4px 16px rgba(46,158,107,.25)",
    }}>
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:8}}>
        <span style={{fontSize:16}}>🎯</span>
        <span style={{fontSize:10, fontWeight:800, color:"rgba(255,255,255,.7)", letterSpacing:.5}}>SAVIEZ-VOUS ? · RETEX DU SERVICE</span>
      </div>
      <div style={{fontSize:14, fontWeight:700, color:"#fff", lineHeight:1.5, marginBottom:8}}>
        "{item.takehome}"
      </div>
      <div style={{fontSize:10, color:"rgba(255,255,255,.65)"}}>
        {[item.author, item.date, item.lieu].filter(Boolean).join(" · ")} — Tap pour lire →
      </div>
    </div>
  );
}

// ─── RETEX PÉDAGOGIQUE ────────────────────────────────────────────────────────

const REACTIONS = [
  { emoji:"💡", label:"Instructif" },
  { emoji:"⚠️", label:"Important" },
  { emoji:"👏", label:"Bravo" },
  { emoji:"🎯", label:"Essentiel" },
];

// ── Formulaire d'ajout RETEX/Récit ────────────────────────────────────────────
function RetexSubmitForm({ onSubmit, onCancel }) {
  const C = useC();
  const [tab, setTab] = useState("retex"); // retex | recit
  const [form, setForm] = useState({
    type:"retex", title:"", author:"", date:"", lieu:"",
    contexte:"", situation:"", bien:"", difficultes:"", amelio:"", takehome:"",
    recit:"", tags:"", gravite:"", categorie:"Réanimation", medias:[],
  });
  const [saving, setSaving] = useState(false);

  const CATS = ["Réanimation","Cardiologie","Neurologie","Traumatologie","SMUR","Pédiatrie","Toxicologie","Infectiologie","Autre"];

  const inp = {
    width:"100%", border:`1px solid ${C.border}`, borderRadius:10,
    padding:"10px 12px", fontSize:13, color:C.text, background:C.white,
    boxSizing:"border-box", marginBottom:10, outline:"none", fontFamily:"inherit",
  };
  const lbl = { fontSize:11, fontWeight:700, color:C.sub, marginBottom:4, display:"block" };
  const ta = (h) => ({...inp, height:h, resize:"vertical"});

  function switchTab(t) {
    setTab(t);
    setForm(f=>({...f, type:t}));
  }

  async function handleSubmit() {
    if(!form.title.trim()) return;
    setSaving(true);
    await onSubmit(form);
    setSaving(false);
  }

  return (
    <div style={{animation:"fadeIn .2s ease"}}>
      {/* Header */}
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16}}>
        <div style={{fontSize:17, fontWeight:900, color:C.navy}}>📝 Nouvelle publication</div>
        <button onClick={onCancel} style={{background:"none", border:"none", color:C.sub, fontSize:22, cursor:"pointer"}}>✕</button>
      </div>

      {/* 2 onglets */}
      <div style={{display:"flex", gap:8, marginBottom:16}}>
        {[{v:"retex",l:"🔬 RETEX structuré"},{v:"recit",l:"📖 Récit libre"}].map(t=>(
          <button key={t.v} onClick={()=>switchTab(t.v)} style={{
            flex:1, border:`2px solid ${tab===t.v?C.green:C.border}`,
            background:tab===t.v?C.greenLight:"#fff",
            borderRadius:10, padding:"10px 6px", fontSize:12, fontWeight:700,
            color:tab===t.v?C.green:C.sub, cursor:"pointer"
          }}>{t.l}</button>
        ))}
      </div>

      {/* Champs communs */}
      <label style={lbl}>Titre *</label>
      <input style={inp} placeholder={tab==="retex"?"Ex: Arrêt cardiaque en salle d'attente":"Ex: Prise en charge d'un polytraumatisé SMUR"} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>

      <div style={{display:"flex", gap:8}}>
        <div style={{flex:1}}>
          <label style={lbl}>Auteur</label>
          <input style={inp} placeholder="Dr. Martin (ou anonyme)" value={form.author} onChange={e=>setForm({...form,author:e.target.value})}/>
        </div>
        <div style={{flex:1}}>
          <label style={lbl}>Date</label>
          <input style={inp} type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/>
        </div>
      </div>

      <label style={lbl}>Lieu / Secteur</label>
      <input style={inp} placeholder="SAU · SMUR · SAUV..." value={form.lieu} onChange={e=>setForm({...form,lieu:e.target.value})}/>

      <label style={lbl}>Catégorie</label>
      <select style={inp} value={form.categorie} onChange={e=>setForm({...form,categorie:e.target.value})}>
        {CATS.map(c=><option key={c}>{c}</option>)}
      </select>

      <label style={lbl}>Gravité perçue</label>
      <div style={{display:"flex", gap:6, marginBottom:10}}>
        {[{v:"critique",l:"🔴 Critique"},{v:"serieux",l:"🟠 Sérieux"},{v:"modere",l:"🟡 Modéré"},{v:"formateur",l:"🟢 Formateur"}].map(g=>(
          <button key={g.v} onClick={()=>setForm({...form,gravite:g.v})} style={{
            flex:1, border:`1.5px solid ${form.gravite===g.v?C.blue:C.border}`,
            background:form.gravite===g.v?C.blueLight:"transparent",
            borderRadius:8, padding:"6px 2px", fontSize:10, fontWeight:700,
            color:form.gravite===g.v?C.blue:C.sub, cursor:"pointer"
          }}>{g.l}</button>
        ))}
      </div>

      {/* Champs RETEX structuré */}
      {tab==="retex" && (
        <div>
          <label style={lbl}>📍 Contexte</label>
          <textarea style={ta(70)} placeholder="Heure, équipe présente, ressources disponibles..." value={form.contexte} onChange={e=>setForm({...form,contexte:e.target.value})}/>
          <label style={lbl}>🩺 Situation clinique</label>
          <textarea style={ta(90)} placeholder="Présentation clinique, décisions prises, chronologie..." value={form.situation} onChange={e=>setForm({...form,situation:e.target.value})}/>
          <label style={lbl}>✅ Ce qui a bien fonctionné</label>
          <textarea style={ta(60)} placeholder="Points positifs, réflexes acquis..." value={form.bien} onChange={e=>setForm({...form,bien:e.target.value})}/>
          <label style={lbl}>⚠️ Difficultés rencontrées</label>
          <textarea style={ta(60)} placeholder="Points de friction, imprévus..." value={form.difficultes} onChange={e=>setForm({...form,difficultes:e.target.value})}/>
          <label style={lbl}>💡 Ce que l'on ferait différemment</label>
          <textarea style={ta(60)} placeholder="Axes d'amélioration concrets..." value={form.amelio} onChange={e=>setForm({...form,amelio:e.target.value})}/>
        </div>
      )}

      {/* Champs récit libre */}
      {tab==="recit" && (
        <div>
          <label style={lbl}>Récit de l'intervention *</label>
          <textarea style={ta(180)} placeholder={"Raconte l'intervention librement, avec le plus de détails utiles...\n\nQui, quoi, où, quand, comment ?"} value={form.recit} onChange={e=>setForm({...form,recit:e.target.value})}/>
        </div>
      )}

      {/* Take home message (commun) */}
      <label style={lbl}>🎯 Take home message</label>
      <textarea style={ta(70)} placeholder="Le message clé à retenir..." value={form.takehome} onChange={e=>setForm({...form,takehome:e.target.value})}/>

      <label style={lbl}>Tags (optionnel)</label>
      <input style={inp} placeholder="#SMUR #SCA #Pediatrie" value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})}/>

      <MediaUploader
        label="📎 Photos / Vidéos / PDF (optionnel)"
        medias={form.medias||[]}
        onChange={upd => setForm(f=>({...f, medias: typeof upd==="function"?upd(f.medias):upd}))}
        accept="image/*,video/*,application/pdf"
      />

      <button onClick={handleSubmit} disabled={saving||!form.title.trim()} style={{
        width:"100%", background:form.title.trim()?C.green:"#CBD5E1",
        border:"none", borderRadius:10, padding:"14px", fontSize:14,
        fontWeight:800, color:"#fff", cursor:form.title.trim()?"pointer":"not-allowed",
        marginTop:4,
      }}>
        {saving?"Enregistrement...":"✅ Publier"}
      </button>
    </div>
  );
}

// ── Vue détail d'un RETEX ─────────────────────────────────────────────────────
function RetexDetail({ item, onBack, onReaction, onComment, onDelete }) {
  const C = useC();
  const { toggleFavori, isFavori } = useFavoris();
  const [commentText, setCommentText] = useState("");
  const [commentAuthor, setCommentAuthor] = useState("");
  const [showCommentForm, setShowCommentForm] = useState(false);

  const typeColors = { recit:"#9B59B6", retex:"#2E9E6B" };
  const typeIcons  = { recit:"📖", retex:"🔬" };
  const typeLabels = { recit:"Récit d'intervention", retex:"RETEX structuré" };
  const col = typeColors[item.type]||"#2E9E6B";

  const sections = [
    { key:"contexte",    label:"Contexte",                        icon:"📍", color:"#2E7EAD" },
    { key:"situation",   label:"Situation clinique",              icon:"🩺", color:"#1A3A5C" },
    { key:"bien",        label:"Ce qui a bien fonctionné",        icon:"✅", color:"#2E9E6B" },
    { key:"difficultes", label:"Difficultés rencontrées",         icon:"⚠️", color:"#E8A82E" },
    { key:"amelio",      label:"Ce que l'on ferait différemment", icon:"💡", color:"#9B59B6" },
  ];

  function relTime(ts) {
    if(!ts) return "";
    const d = Math.floor((Date.now()-ts)/1000);
    if(d<60) return "À l'instant";
    if(d<3600) return `Il y a ${Math.floor(d/60)} min`;
    if(d<86400) return `Il y a ${Math.floor(d/3600)} h`;
    return `Il y a ${Math.floor(d/86400)} j`;
  }

  function handleComment() {
    if(!commentText.trim()) return;
    onComment(item.id, commentAuthor||"Anonyme", commentText);
    setCommentText(""); setCommentAuthor(""); setShowCommentForm(false);
  }

  return (
    <div style={{animation:"fadeIn .2s ease"}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4}}>
        <BackBtn onClick={onBack}/>
        <StarBtn filled={isFavori("retex",item.id)} color={col}
          onToggle={()=>toggleFavori({id:item.id, type:"retex", title:item.title, icon:"🔬", color:col, nav:"retex"})}/>
      </div>

      {/* Header coloré */}
      <div style={{background:`linear-gradient(135deg, ${col} 0%, ${col}BB 100%)`, borderRadius:16, padding:18, marginBottom:16, color:"#fff"}}>
        <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:8}}>
          <span style={{fontSize:18}}>{typeIcons[item.type]||"🔬"}</span>
          <span style={{background:"rgba(255,255,255,.2)", borderRadius:20, padding:"2px 10px", fontSize:10, fontWeight:700}}>
            {typeLabels[item.type]||"RETEX"}
          </span>
          {item.gravite && (
            <span style={{background:"rgba(0,0,0,.2)", borderRadius:20, padding:"2px 10px", fontSize:10, fontWeight:700}}>
              {item.gravite==="critique"?"🔴":item.gravite==="serieux"?"🟠":item.gravite==="modere"?"🟡":"🟢"} {item.gravite}
            </span>
          )}
        </div>
        <div style={{fontSize:17, fontWeight:800, lineHeight:1.3, marginBottom:6}}>{item.title}</div>
        <div style={{fontSize:11, opacity:.8}}>
          {[item.author, item.date, item.lieu, item.categorie].filter(Boolean).join(" · ")}
        </div>
        {(item.tags&&item.tags.length>0) && (
          <div style={{display:"flex", flexWrap:"wrap", gap:6, marginTop:8}}>
            {item.tags.map((t,i)=>(
              <span key={i} style={{background:"rgba(255,255,255,.18)", color:"#fff", padding:"2px 10px", borderRadius:20, fontSize:11, fontWeight:700}}>{t}</span>
            ))}
          </div>
        )}
      </div>

      {/* Récit libre */}
      {item.type==="recit" && item.recit && (
        <div style={{background:C.white, borderRadius:14, padding:16, marginBottom:14, border:`1px solid ${C.border}`}}>
          <div style={{fontSize:13, color:C.text, lineHeight:1.7, whiteSpace:"pre-wrap"}}>{item.recit}</div>
        </div>
      )}

      {/* Sections RETEX structuré */}
      {item.type==="retex" && sections.map(s => item[s.key] ? (
        <div key={s.key} style={{marginBottom:10}}>
          <div style={{display:"flex", alignItems:"center", gap:6, marginBottom:6}}>
            <span style={{fontSize:14}}>{s.icon}</span>
            <span style={{fontSize:11, fontWeight:800, color:s.color, letterSpacing:.5}}>{s.label.toUpperCase()}</span>
          </div>
          <div style={{background:C.white, borderRadius:12, padding:14, border:`1px solid ${C.border}`, borderLeft:`3px solid ${s.color}`}}>
            <div style={{fontSize:13, color:C.text, lineHeight:1.6, whiteSpace:"pre-wrap"}}>{item[s.key]}</div>
          </div>
        </div>
      ) : null)}

      {/* Take home message */}
      {item.takehome && (
        <div style={{background:"#FDF0F1", border:`2px solid #E05260`, borderRadius:14, padding:14, margin:"4px 0 16px"}}>
          <div style={{display:"flex", alignItems:"center", gap:6, marginBottom:6}}>
            <span style={{fontSize:16}}>🎯</span>
            <span style={{fontSize:11, fontWeight:800, color:"#E05260", letterSpacing:.5}}>TAKE HOME MESSAGE</span>
          </div>
          <div style={{fontSize:14, fontWeight:700, color:C.text, lineHeight:1.5}}>{item.takehome}</div>
        </div>
      )}

      {/* Médias */}
      {item.medias?.length > 0 && (
        <div style={{marginBottom:16}}>
          <div style={{fontSize:11, fontWeight:800, color:C.sub, marginBottom:8}}>📎 DOCUMENTS / MÉDIAS</div>
          <MediaGallery medias={item.medias}/>
        </div>
      )}

      {/* Réactions */}
      <div style={{marginBottom:16}}>
        <div style={{fontSize:11, fontWeight:800, color:C.sub, marginBottom:8}}>RÉACTIONS DU SERVICE</div>
        <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
          {REACTIONS.map(r=>{
            const count = (item.reactions||{})[r.emoji]||0;
            return (
              <button key={r.emoji} onClick={()=>onReaction(item.id, r.emoji)} style={{
                display:"flex", alignItems:"center", gap:5,
                background:count>0?C.greenLight:C.white,
                border:`1.5px solid ${count>0?C.green:C.border}`,
                borderRadius:20, padding:"6px 12px", cursor:"pointer",
              }}>
                <span style={{fontSize:16}}>{r.emoji}</span>
                <span style={{fontSize:11, fontWeight:700, color:count>0?C.green:C.sub}}>{r.label}</span>
                {count>0 && <span style={{fontSize:11, fontWeight:800, color:C.green}}>×{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Commentaires */}
      <div style={{marginBottom:16}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
          <div style={{fontSize:11, fontWeight:800, color:C.sub}}>💬 DISCUSSIONS ({(item.comments||[]).length})</div>
          <button onClick={()=>setShowCommentForm(v=>!v)} style={{background:C.blueLight, border:"none", borderRadius:8, padding:"4px 10px", fontSize:11, fontWeight:700, color:C.blue, cursor:"pointer"}}>+ Commenter</button>
        </div>
        {showCommentForm && (
          <div style={{background:C.blueLight, borderRadius:12, padding:12, marginBottom:10}}>
            <input value={commentAuthor} onChange={e=>setCommentAuthor(e.target.value)} placeholder="Votre prénom (optionnel)"
              style={{width:"100%", border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px", fontSize:12, color:C.text, background:C.white, boxSizing:"border-box", marginBottom:6, outline:"none"}}/>
            <textarea value={commentText} onChange={e=>setCommentText(e.target.value)} placeholder="Votre retour, question ou compléments..."
              style={{width:"100%", border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px", fontSize:12, color:C.text, background:C.white, boxSizing:"border-box", height:70, resize:"vertical", outline:"none", fontFamily:"inherit"}}/>
            <div style={{display:"flex", gap:6}}>
              <button onClick={handleComment} style={{flex:1, background:C.blue, border:"none", borderRadius:8, padding:"8px", fontSize:12, fontWeight:700, color:"#fff", cursor:"pointer"}}>Envoyer</button>
              <button onClick={()=>setShowCommentForm(false)} style={{background:C.white, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 12px", fontSize:12, color:C.sub, cursor:"pointer"}}>Annuler</button>
            </div>
          </div>
        )}
        {(item.comments||[]).length===0 && !showCommentForm && (
          <div style={{fontSize:12, color:C.sub, textAlign:"center", padding:"10px 0"}}>Aucun commentaire — soyez le premier à réagir !</div>
        )}
        <div style={{display:"flex", flexDirection:"column", gap:8}}>
          {(item.comments||[]).map(cm=>(
            <div key={cm.id} style={{background:C.white, borderRadius:12, padding:"10px 14px", border:`1px solid ${C.border}`}}>
              <div style={{display:"flex", justifyContent:"space-between", marginBottom:4}}>
                <span style={{fontSize:12, fontWeight:700, color:C.blue}}>👤 {cm.author}</span>
                <span style={{fontSize:10, color:C.sub}}>{relTime(cm.ts)}</span>
              </div>
              <div style={{fontSize:13, color:C.text, lineHeight:1.5}}>{cm.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Supprimer */}
      <button onClick={()=>onDelete(item.id)} style={{width:"100%", background:"none", border:`1px solid ${C.border}`, borderRadius:10, padding:"10px", fontSize:11, fontWeight:700, color:"#E05260", cursor:"pointer", marginTop:4}}>
        🗑 Supprimer cette publication
      </button>
    </div>
  );
}

// ── RetexScreen ───────────────────────────────────────────────────────────────
function RetexScreen({ deepLinkId }) {
  const C = useC();
  const { store, addRetexItem, removeRetexItem, updateRetex } = useData();
  const items = store.retex;
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("tous");
  const [search, setSearch] = useState("");

  async function submit(form) {
    const tags = (form.tags||"").split(/[\s,]+/).filter(Boolean).map(t=>t.startsWith("#")?t:"#"+t);
    const item = {...form, tags, id:Date.now(), ts:Date.now(), reactions:{}, comments:[], date:form.date||new Date().toLocaleDateString("fr-FR")};
    await addRetexItem(item);
    return item;
  }

  async function toggleReaction(id, emoji) {
    const item = items.find(x=>x.id===id);
    if(!item) return;
    const reactions = {...(item.reactions||{})};
    reactions[emoji] = (reactions[emoji]||0) + (reactions[emoji] ? -1 : 1);
    if(reactions[emoji]<=0) delete reactions[emoji];
    await updateRetex({...item, reactions});
  }

  async function addComment(id, author, text) {
    const item = items.find(x=>x.id===id);
    if(!item) return;
    const comment = {id:Date.now(), author, text, ts:Date.now()};
    await updateRetex({...item, comments:[...(item.comments||[]), comment]});
  }

  async function deleteItem(id) {
    await removeRetexItem(id);
    setSelected(null);
  }

  useEffect(()=>{
    if(deepLinkId && items.length){
      const it=items.find(x=>x.id===deepLinkId||x.id===Number(deepLinkId));
      if(it) setSelected(it);
    }
  },[deepLinkId,items]);

  useEffect(()=>{
    if(selected){ const el=document.querySelector('[data-content-scroll]'); if(el) el.scrollTop=0; }
  },[selected]);

  const selectedItem = selected ? items.find(x=>x.id===selected.id)||selected : null;

  const typeColors = { recit:"#9B59B6", retex:"#2E9E6B" };
  const typeIcons  = { recit:"📖", retex:"🔬" };
  const typeLabels = { recit:"Récit", retex:"RETEX" };

  const filtered = items.filter(x=>{
    if(filter==="retex") return x.type==="retex";
    if(filter==="recit") return x.type==="recit";
    return true;
  }).filter(x=>
    !search || x.title?.toLowerCase().includes(search.toLowerCase()) ||
    (x.tags||[]).some(t=>t.toLowerCase().includes(search.toLowerCase()))
  );

  if(showForm) return (
    <RetexSubmitForm
      onSubmit={async (form)=>{ await submit(form); setShowForm(false); }}
      onCancel={()=>setShowForm(false)}
    />
  );

  if(selectedItem) return (
    <RetexDetail
      item={selectedItem}
      onBack={()=>setSelected(null)}
      onReaction={toggleReaction}
      onComment={addComment}
      onDelete={(id)=>{ deleteItem(id); setSelected(null); }}
    />
  );

  return (
    <div>
      {/* Header */}
      <div style={{marginBottom:16}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}}>
          <div>
            <h2 style={{color:C.navy, fontWeight:900, fontSize:18, margin:0}}>🔬 RETEX / Cas cliniques</h2>
            <div style={{fontSize:11, color:C.sub, marginTop:2}}>{items.length} publication{items.length>1?"s":""}</div>
          </div>
          <button onClick={()=>setShowForm(true)} style={{background:C.green, border:"none", borderRadius:10, padding:"10px 16px", fontSize:12, fontWeight:800, color:"#fff", cursor:"pointer"}}>+ Ajouter</button>
        </div>

        {/* Recherche */}
        <div style={{display:"flex", alignItems:"center", gap:8, background:C.white, border:`1px solid ${C.border}`, borderRadius:12, padding:"9px 12px", marginBottom:10}}>
          <span style={{fontSize:13, opacity:.5}}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher un titre, un tag..."
            style={{flex:1, border:"none", outline:"none", fontSize:13, color:C.text, background:"transparent", fontFamily:"inherit"}}/>
          {search && <button onClick={()=>setSearch("")} style={{background:"none", border:"none", color:C.sub, cursor:"pointer", fontSize:14, padding:0}}>✕</button>}
        </div>

        {/* 2 onglets + Tous */}
        <div style={{display:"flex", gap:6}}>
          {[
            {v:"tous",  l:`Tous (${items.length})`},
            {v:"retex", l:`🔬 RETEX (${items.filter(x=>x.type==="retex").length})`},
            {v:"recit", l:`📖 Récits (${items.filter(x=>x.type==="recit").length})`},
          ].map(f=>(
            <button key={f.v} onClick={()=>setFilter(f.v)} style={{
              flex:1, background:filter===f.v?C.navy:C.blueLight,
              color:filter===f.v?"#fff":C.navy,
              border:"none", borderRadius:20, padding:"6px 4px",
              fontSize:11, fontWeight:700, cursor:"pointer",
            }}>{f.l}</button>
          ))}
        </div>
      </div>

      {/* Liste vide */}
      {filtered.length===0 && (
        <div style={{textAlign:"center", padding:"40px 20px", color:C.sub}}>
          <div style={{fontSize:48, marginBottom:12}}>🔬</div>
          <div style={{fontSize:14, fontWeight:700, color:C.navy, marginBottom:8}}>
            {items.length===0?"Aucune publication pour l'instant":"Aucun résultat"}
          </div>
          {items.length===0 && (
            <button onClick={()=>setShowForm(true)} style={{background:C.green, border:"none", borderRadius:10, padding:"12px 24px", fontSize:13, fontWeight:800, color:"#fff", cursor:"pointer"}}>
              📝 Ajouter un RETEX
            </button>
          )}
        </div>
      )}

      {/* Liste */}
      <div style={{display:"flex", flexDirection:"column", gap:10}}>
        {filtered.map(c=>{
          const col = typeColors[c.type]||C.green;
          const totalR = Object.values(c.reactions||{}).reduce((s,v)=>s+v,0);
          const totalC = (c.comments||[]).length;
          return (
            <div key={c.id} onClick={()=>setSelected(c)} style={{
              background:C.white, borderRadius:14, border:`1px solid ${C.border}`,
              overflow:"hidden", cursor:"pointer",
              boxShadow:"0 2px 10px rgba(26,58,92,.06)", animation:"fadeIn .2s ease",
            }}>
              <div style={{height:3, background:`linear-gradient(90deg, ${col}, ${col}66)`}}/>
              <div style={{padding:"12px 14px"}}>
                <div style={{display:"flex", alignItems:"center", gap:5, marginBottom:8, flexWrap:"wrap"}}>
                  <span style={{background:col+"18", color:col, borderRadius:20, padding:"2px 8px", fontSize:10, fontWeight:700}}>
                    {typeIcons[c.type]||"🔬"} {typeLabels[c.type]||"RETEX"}
                  </span>
                  {c.categorie && <span style={{background:C.blueLight, color:C.blue, borderRadius:20, padding:"2px 8px", fontSize:10, fontWeight:600}}>{c.categorie}</span>}
                  {c.gravite==="critique" && <span style={{fontSize:10, fontWeight:700, color:"#E05260"}}>🔴 Critique</span>}
                </div>
                <div style={{fontSize:14, fontWeight:800, color:C.text, marginBottom:5, lineHeight:1.3}}>{c.title}</div>
                {(c.contexte||c.recit||c.situation) && (
                  <div style={{fontSize:12, color:C.sub, lineHeight:1.4, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical"}}>
                    {c.contexte||c.recit||c.situation}
                  </div>
                )}
                <div style={{display:"flex", gap:8, marginTop:8, alignItems:"center", flexWrap:"wrap"}}>
                  {c.author && <span style={{fontSize:10, color:C.sub}}>👤 {c.author}</span>}
                  {c.date   && <span style={{fontSize:10, color:C.sub}}>📅 {c.date}</span>}
                  <div style={{flex:1}}/>
                  {totalR>0 && <span style={{fontSize:10, color:"#E8A82E", fontWeight:700}}>💡 ×{totalR}</span>}
                  {totalC>0 && <span style={{fontSize:10, color:C.blue, fontWeight:700}}>💬 {totalC}</span>}
                  <span style={{color:C.sub, fontSize:16}}>›</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {items.length>0 && (
        <div style={{textAlign:"center", padding:"24px 0 8px"}}>
          <button onClick={()=>setShowForm(true)} style={{background:C.green, border:"none", borderRadius:12, padding:"12px 28px", fontSize:13, fontWeight:800, color:"#fff", cursor:"pointer", boxShadow:"0 4px 16px rgba(46,158,107,.25)"}}>
            📝 Ajouter une publication
          </button>
        </div>
      )}
    </div>
  );
}
// - ECGScreen -
function ECGScreen({ deepLinkId }) {
  const C = useC();
  const { store } = useData();
  const [revealedIds, setRevealedIds] = useState({});
  const [selected, setSelected] = useState(null);
  const { toggleFavori, isFavori } = useFavoris();

  const ecgs = [...ECGS, ...store.ecgs];

  useEffect(()=>{ if(deepLinkId && ecgs.length){ const it=ecgs.find(x=>x.id===deepLinkId||x.id===Number(deepLinkId)); if(it) setSelected(it); } },[deepLinkId, store.ecgs]);
  useEffect(()=>{ if(selected){ const el=document.querySelector('[data-content-scroll]'); if(el) el.scrollTop=0; } },[selected]);

  const reveal = (id) => setRevealedIds(prev => ({...prev, [id]:true}));

  const SvgEcg = ({color}) => (
    <svg viewBox="0 0 300 80" style={{width:"100%", height:80}}>
      <polyline points="0,40 30,40 40,40 50,10 60,70 70,40 100,40 110,40 120,25 130,55 140,40 170,40 180,40 190,15 200,65 210,40 240,40 250,40 260,28 270,52 280,40 300,40"
        fill="none" stroke={color||"#E05260"} strokeWidth="2"/>
    </svg>
  );

  useEffect(()=>{
    if(selected) { const el = document.querySelector('[data-content-scroll]'); if(el) el.scrollTop=0; }
  },[selected]);

  if(selected) {
    const e = ecgs.find(x=>x.id===selected.id) || selected;
    const isRevealed = revealedIds[e.id] || e.revealed;
    return (
      <div>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4}}>
          <BackBtn onClick={()=>setSelected(null)}/>
          <StarBtn filled={isFavori("ecg",e.id)} color={e.color||C.red}
            onToggle={()=>toggleFavori({id:e.id, type:"ecg", title:e.title, icon:"❤️", color:e.color||C.red, nav:"ecg"})}/>
        </div>
        <Tag label={"ECG · À analyser"} color={e.color||C.red}/>
        <h2 style={{color:C.navy, fontSize:17, fontWeight:800, margin:"12px 0 8px"}}>{e.title}</h2>
        <div style={{fontSize:12, color:C.sub, marginBottom:8}}>{e.context}</div>
          {(e.tags&&e.tags.length>0) && (
            <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:12}}>
              {e.tags.map((t,i)=>(
                <span key={i} style={{background:C.red+"22", color:C.red, padding:"2px 10px", borderRadius:20, fontSize:11, fontWeight:700}}>{t}</span>
              ))}
            </div>
          )}

        <div style={{background:"#0A1628", borderRadius:14, padding:(e.imageData||e.imageUrl)?4:16, marginBottom:16}}>
          {(e.imageUrl || e.imageData) ? (
            <ClickableImage src={e.imageData || e.imageUrl} alt="ECG" style={{borderRadius:10}}/>
          ) : (
            <SvgEcg color={e.color}/>
          )}
          {!(e.imageData||e.imageUrl) && <div style={{color:"rgba(255,255,255,.5)", fontSize:10, textAlign:"center", marginTop:8}}>ECG - {e.title}</div>}
        </div>

        {e.hasSecondEcg && (e.imageUrl2 || e.imageData2) && (
          <div style={{background:"#0A1628", borderRadius:14, padding:(e.imageData2||e.imageUrl2)?4:16, marginBottom:16}}>
            <div style={{color:"rgba(255,255,255,.7)", fontSize:11, fontWeight:700, marginBottom:8, padding:"8px 8px 0"}}>{e.secondTitle}</div>
            <ClickableImage src={e.imageData2 || e.imageUrl2} alt="ECG 2" style={{borderRadius:10}}/>
          </div>
        )}

        <div style={{background:C.amberLight, border:`2px solid ${C.amber}`, borderRadius:12, padding:14, marginBottom:16}}>
          <div style={{fontSize:11, fontWeight:800, color:C.amber, marginBottom:4}}>QUESTION</div>
          <div style={{fontSize:14, fontWeight:700, color:C.text}}>{e.question}</div>
        </div>

        {!isRevealed ? (
          <Btn onClick={()=>reveal(e.id)} color={e.color} style={{width:"100%", padding:14}}>
            Reveler l'interpretation
          </Btn>
        ) : (
          <div>
            <Card style={{border:`2px solid ${e.color}`, marginBottom:10}}>
              <div style={{fontSize:11, fontWeight:800, color:e.color, marginBottom:4}}>INTERPRETATION</div>
              <div style={{fontSize:13, color:C.text, lineHeight:1.5}}>{e.interpretation}</div>
            </Card>
            <Card style={{border:`2px solid ${C.green}`, marginBottom:10}}>
              <div style={{fontSize:11, fontWeight:800, color:C.green, marginBottom:4}}>DIAGNOSTIC</div>
              <div style={{fontSize:14, fontWeight:700, color:C.text}}>{e.diagnosis}</div>
            </Card>
            {e.points && e.points.length > 0 && (
              <Card>
                <div style={{fontSize:11, fontWeight:800, color:C.navy, marginBottom:8}}>POINTS PEDAGOGIQUES</div>
                <div style={{display:"flex", flexDirection:"column", gap:8}}>
                  {e.points.map((p,i) => (
                    <div key={i} style={{display:"flex", gap:8, fontSize:13, color:C.text, lineHeight:1.5}}>
                      <span style={{color:C.blue, flexShrink:0}}>&#8226;</span>{p}
                    </div>
                  ))}
                </div>
              </Card>
            )}
            {e.medias?.length > 0 && (
              <div style={{marginTop:12}}>
                <div style={{fontSize:11, fontWeight:800, color:C.navy, marginBottom:8}}>IMAGES COMPLEMENTAIRES</div>
                <MediaGallery medias={e.medias}/>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <h2 style={{color:C.navy, fontWeight:800, fontSize:18, marginBottom:16}}>{"❤️"} ECG</h2>
      <div style={{display:"flex", flexDirection:"column", gap:12}}>
        {ecgs.map(e => (
          <Card key={e.id} onClick={()=>setSelected(e)}>
            <div style={{display:"flex", gap:12, alignItems:"center"}}>
              <div style={{background:C.redLight, borderRadius:12, padding:8, minWidth:56, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden"}}>
                {(e.imageUrl || e.imageData)
                  ? <img src={e.imageData || e.imageUrl} alt="ECG" style={{width:56, height:40, objectFit:"cover", borderRadius:6}}/>
                  : <svg viewBox="0 0 60 30" style={{width:56, height:30}}><polyline points="0,15 8,15 12,5 16,25 20,15 28,15 32,8 36,22 40,15 48,15 52,10 56,20 60,15" fill="none" stroke={e.color||C.red} strokeWidth="1.5"/></svg>
                }
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13, fontWeight:700, color:C.text, marginBottom:4}}>{e.title}</div>
                <Tag label={revealedIds[e.id] || e.revealed ? "Vu" : "A analyser"} color={revealedIds[e.id] || e.revealed ? C.green : e.color}/>
              </div>
              <div style={{color:C.sub, fontSize:18}}>&#8250;</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// - IconoScreen -
function IconoScreen({ deepLinkId }) {
  const C = useC();
  const { store } = useData();
  const [revealed, setRevealed] = useState({});
  const [selected, setSelected] = useState(null);
  const { toggleFavori, isFavori } = useFavoris();

  const allCases = [...ICONO, ...store.imagerie];

  useEffect(()=>{ if(deepLinkId && allCases.length){ const it=allCases.find(x=>x.id===deepLinkId||x.id===Number(deepLinkId)); if(it) setSelected(it); } },[deepLinkId, store.imagerie]);
  useEffect(()=>{ if(selected){ const el=document.querySelector('[data-content-scroll]'); if(el) el.scrollTop=0; } },[selected]);

  if(selected) {
    const c = allCases.find(x=>x.id===selected.id);
    return (
      <div>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4}}>
          <BackBtn onClick={()=>setSelected(null)}/>
          <StarBtn filled={isFavori("icono",c.id)} color={c.color||"#9B59B6"}
            onToggle={()=>toggleFavori({id:c.id, type:"icono", title:c.title, icon:"🩻", color:c.color||"#9B59B6", nav:"imagerie"})}/>
        </div>
        <Tag label={c.type} color={c.color}/>
        <h2 style={{color:C.navy, fontSize:17, fontWeight:800, margin:"12px 0 8px"}}>{c.title}</h2>
        <div style={{fontSize:12, color:C.sub, marginBottom:16}}>{c.context}</div>
        <div style={{background:"#0A1628", borderRadius:14, padding:c.imageData?4:30, textAlign:"center", marginBottom:16}}>
          {c.imageData && c.isVideo ? (
            <video src={c.imageData || c.imageUrl} controls style={{width:"100%", borderRadius:10, display:"block"}}/>
          ) : c.imageData ? (
            <ClickableImage src={c.imageData || c.imageUrl} alt={c.title} style={{borderRadius:10}}/>
          ) : (
            <div>
              <div style={{fontSize:60}}>{"🩻"}</div>
              <div style={{color:"rgba(255,255,255,.5)", fontSize:11, marginTop:8}}>{c.type} - {c.title}</div>
            </div>
          )}
        </div>
        <div style={{background:C.amberLight, border:`2px solid ${C.amber}`, borderRadius:12, padding:14, marginBottom:16}}>
          <div style={{fontSize:11, fontWeight:800, color:C.amber, marginBottom:4}}>QUESTION</div>
          <div style={{fontSize:14, fontWeight:700, color:C.text}}>{c.question}</div>
        </div>
        {!revealed[c.id] ? (
          <Btn onClick={()=>setRevealed(r=>({...r,[c.id]:true}))} color={c.color} style={{width:"100%", padding:14}}>
            Reveler le diagnostic
          </Btn>
        ) : (
          <>
            <Card style={{border:`2px solid ${c.color}`, marginBottom:12}}>
              <div style={{fontSize:11, fontWeight:800, color:C.green, marginBottom:4}}>DIAGNOSTIC</div>
              <div style={{fontSize:13, color:C.text, lineHeight:1.5}}>{c.diag}</div>
            {(c.tags&&c.tags.length>0) && (
              <div style={{display:"flex", flexWrap:"wrap", gap:6, marginTop:10}}>
                {c.tags.map((t,i)=>(
                  <span key={i} style={{background:"#9B59B6"+"22", color:"#9B59B6", padding:"2px 10px", borderRadius:20, fontSize:11, fontWeight:700}}>{t}</span>
                ))}
              </div>
            )}
            </Card>
            {c.medias?.length > 0 && (
              <div style={{marginTop:4}}>
                <div style={{fontSize:11, fontWeight:800, color:"#9B59B6", marginBottom:8}}>IMAGES COMPLÉMENTAIRES</div>
                <MediaGallery medias={c.medias}/>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <h2 style={{color:C.navy, fontWeight:800, fontSize:18, marginBottom:16}}>{"🖼️"} Imagerie</h2>
      {allCases.length===0 && (
        <div style={{textAlign:"center", padding:"40px 20px", color:C.sub}}>
          <div style={{fontSize:48, marginBottom:12}}>{"🩻"}</div>
          <div style={{fontSize:14, fontWeight:700, color:C.navy, marginBottom:6}}>Aucun cas pour le moment</div>
          <div style={{fontSize:12, lineHeight:1.5}}>Ajoutez vos premiers cas depuis l'Éditeur de fiches</div>
        </div>
      )}
      <div style={{display:"flex", flexDirection:"column", gap:12}}>
        {allCases.map(c => (
          <Card key={c.id} onClick={()=>setSelected(c)}>
            <div style={{display:"flex", gap:12, alignItems:"center"}}>
              <div style={{background:(c.color||C.blue)+"22", borderRadius:12, width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24}}>
                {(c.imageData||c.imageUrl) ? <img src={c.imageData||c.imageUrl} style={{width:44, height:44, borderRadius:12, objectFit:"cover"}}/> : (c.emoji||"🩻")}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13, fontWeight:700, color:C.text, marginBottom:4}}>{c.title}</div>
                <Tag label={c.type} color={c.color}/>
              </div>
              <div style={{color:C.sub, fontSize:18}}>&#8250;</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── MiniCalendar : visuel mensuel des événements ─────────────────────────
function MiniCalendar({ events }) {
  const C = useC();

  function parseFrDate(str) {
    if (!str) return null;
    const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2])-1, parseInt(iso[3]));
    const m2 = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m2) return new Date(parseInt(m2[3]), parseInt(m2[2])-1, parseInt(m2[1]));
    const mo = {janvier:0,fevrier:1,"février":1,mars:2,avril:3,mai:4,juin:5,juillet:6,"août":7,aout:7,septembre:8,octobre:9,novembre:10,"décembre":11,decembre:11};
    const m = str.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
    if (m) { const mn = mo[m[2].toLowerCase()]; if(mn!==undefined) return new Date(parseInt(m[3]),mn,parseInt(m[1])); }
    return null;
  }

  const now = new Date();
  // Recalcule parsed à chaque render → réactif aux nouveaux événements sans délai
  const parsed = events.map(e => ({...e, _date: parseFrDate(e.date)})).filter(e => e._date);

  // Mois initial = mois du prochain événement à venir, sinon mois courant
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const future0 = parsed.filter(e => e._date >= startOfThisMonth).sort((a,b)=>a._date-b._date);
  const initRef = future0.length > 0 ? future0[0]._date : now;

  const [calMonth, setCalMonth] = useState(initRef.getMonth());
  const [calYear, setCalYear]   = useState(initRef.getFullYear());

  const monthNames = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  const dayNames   = ["L","M","M","J","V","S","D"];

  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay  = new Date(calYear, calMonth+1, 0);
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  const daysInMonth = lastDay.getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const eventsThisMonth = parsed.filter(e => e._date.getMonth()===calMonth && e._date.getFullYear()===calYear);
  const evByDay = {};
  eventsThisMonth.forEach(e => {
    const d = e._date.getDate();
    if (!evByDay[d]) evByDay[d] = [];
    evByDay[d].push(e);
  });
  const evDays = new Set(Object.keys(evByDay).map(Number));

  const isToday = (d) => d && new Date().getDate()===d && new Date().getMonth()===calMonth && new Date().getFullYear()===calYear;

  return (
    <div style={{background:C.card, borderRadius:14, padding:16, boxShadow:`0 2px 12px rgba(0,0,0,.06)`, border:`1px solid ${C.border}`, marginBottom:16}}>
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12}}>
        <button onClick={()=>{ const d=new Date(calYear,calMonth-1,1); setCalMonth(d.getMonth()); setCalYear(d.getFullYear()); }}
          style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:C.sub,padding:"0 4px"}}>‹</button>
        <div style={{fontSize:13, fontWeight:800, color:C.navy}}>{monthNames[calMonth]} {calYear}</div>
        <button onClick={()=>{ const d=new Date(calYear,calMonth+1,1); setCalMonth(d.getMonth()); setCalYear(d.getFullYear()); }}
          style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:C.sub,padding:"0 4px"}}>›</button>
      </div>
      <div style={{display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:4}}>
        {dayNames.map((d,i) => (
          <div key={i} style={{textAlign:"center", fontSize:10, fontWeight:700, color:C.sub, padding:"2px 0"}}>{d}</div>
        ))}
      </div>
      <div style={{display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2}}>
        {cells.map((d,i) => {
          const hasEv = d && evDays.has(d);
          const evCount = hasEv ? (evByDay[d]||[]).length : 0;
          const today = isToday(d);
          const evColor = hasEv && evByDay[d]?.[0]?.color;
          return (
            <div key={i} style={{
              textAlign:"center", padding:"5px 0 3px", borderRadius:8, fontSize:12,
              fontWeight: today||hasEv ? 800 : d ? 500 : 400,
              background: today ? C.blue : hasEv ? (evColor||C.amber)+"33" : "transparent",
              color: today ? "#fff" : hasEv ? (evColor||C.amber) : d ? C.text : "transparent",
              border: hasEv && !today ? `2px solid ${evColor||C.amber}` : today ? "2px solid transparent" : "2px solid transparent",
              boxShadow: hasEv && !today ? `0 0 0 1px ${(evColor||C.amber)}44` : "none",
              position:"relative", minHeight:34,
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
              cursor: hasEv ? "pointer" : "default",
            }}>
              <span>{d||""}</span>
              {hasEv && (
                <div style={{display:"flex", gap:2, marginTop:2}}>
                  {Array.from({length:Math.min(evCount,3)}).map((_,k)=>(
                    <div key={k} style={{
                      width: today ? 4 : 5, height: today ? 4 : 5,
                      borderRadius:"50%",
                      background: today ? "#fff" : (evColor||C.amber)
                    }}/>
                  ))}
                  {evCount > 3 && <div style={{fontSize:8, fontWeight:900, color:today?"#fff":(evColor||C.amber), lineHeight:"5px"}}>+</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {eventsThisMonth.length > 0 ? (
        <div style={{marginTop:12, borderTop:`1px solid ${C.border}`, paddingTop:10, display:"flex", flexDirection:"column", gap:5}}>
          {eventsThisMonth.sort((a,b)=>a._date-b._date).map((e,i)=>(
            <div key={i} style={{display:"flex", alignItems:"center", gap:8}}>
              <div style={{minWidth:28, background:e.color||C.blue, borderRadius:6, textAlign:"center", fontSize:11, fontWeight:800, color:"#fff", padding:"1px 4px"}}>{e._date.getDate()}</div>
              <div style={{fontSize:11, color:C.text, lineHeight:1.3, flex:1}}>{e.title}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{textAlign:"center", color:C.sub, fontSize:11, marginTop:10}}>Aucun événement ce mois</div>
      )}
    </div>
  );
}

// - AgendaScreen -
function AgendaScreen({ deepLinkId }) {
  const C = useC();
  const { store, removeItem } = useData();
  const [selected, setSelected] = useState(null);
  const typeEmoji = {formation:"🎓", reunion:"👥", congres:"🏛️", soiree:"🎉", autre:"📌"};
  const { toggleFavori, isFavori } = useFavoris();

  const allEvents = [...AGENDA, ...store.agenda];

  useEffect(()=>{ if(deepLinkId && allEvents.length){ const it=allEvents.find(x=>x.id===deepLinkId||x.id===Number(deepLinkId)); if(it) setSelected(it); } },[deepLinkId, store.agenda]);
  useEffect(()=>{ if(selected){ const el=document.querySelector('[data-content-scroll]'); if(el) el.scrollTop=0; } },[selected]);

  async function deleteEvent(ev) {
    await removeItem("agenda", "admin_agenda", ev.id, ["imageData"]);
    setSelected(null);
  }

  if(selected) {
    const isFixed = AGENDA.some(a => a.id === selected.id);
    return (
      <div>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4}}>
          <BackBtn onClick={()=>setSelected(null)}/>
          <StarBtn filled={isFavori("agenda",selected.id)} color={selected.color||C.blue}
            onToggle={()=>toggleFavori({id:selected.id, type:"agenda", title:selected.title, icon:"📅", color:selected.color||C.blue, nav:"agenda"})}/>
        </div>
        <div style={{background:selected.color||C.blue, borderRadius:14, padding:20, color:"#fff", marginBottom:16}}>
          <div style={{fontSize:24, marginBottom:8}}>{typeEmoji[selected.type]||"📅"}</div>
          <div style={{fontSize:17, fontWeight:800}}>{selected.title}</div>
        </div>
        <Card style={{marginBottom:12}}>
          <div style={{display:"flex", flexDirection:"column", gap:8}}>
            <div style={{fontSize:12, color:C.sub}}>{"📆"} {(()=>{ const iso=selected.date&&selected.date.match(/^(\d{4})-(\d{2})-(\d{2})$/); return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : selected.date; })()}</div>
            {selected.heure && <div style={{fontSize:12, color:C.sub}}>{"🕐"} {selected.heure}</div>}
            {selected.lieu && <div style={{fontSize:12, color:C.sub}}>{"📍"} {selected.lieu}</div>}
            {(selected.tags&&selected.tags.length>0) && (
              <div style={{display:"flex", flexWrap:"wrap", gap:6, marginTop:8}}>
                {selected.tags.map((t,i)=>(
                  <span key={i} style={{background:C.amber+"22", color:C.amber, padding:"2px 10px", borderRadius:20, fontSize:11, fontWeight:700}}>{t}</span>
                ))}
              </div>
            )}
            {selected.description && <div style={{fontSize:13, color:C.text, marginTop:4, lineHeight:1.5}}>{selected.description}</div>}
          </div>
        </Card>
        {selected.imageData && (
          <div style={{borderRadius:12, overflow:"hidden", marginBottom:12}}>
            {selected.imageUrl&&selected.imageUrl.endsWith(".pdf") ? (
              <a href={selected.imageData} target="_blank" rel="noreferrer" style={{display:"block", background:C.blueLight, borderRadius:12, padding:16, textAlign:"center", color:C.blue, fontWeight:700, fontSize:13, textDecoration:"none"}}>{"📂 Ouvrir le document"}</a>
            ) : (
              <div style={{background:"#f8f9fa", border:"1px solid #e0e0e0", borderRadius:12, overflow:"hidden"}}>
                <ClickableImage src={selected.imageData || selected.imageUrl} alt={selected.title} style={{borderRadius:12}}/>
              </div>
            )}
          </div>
        )}
        {selected.medias?.length > 0 && (
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11, fontWeight:800, color:C.sub, marginBottom:8}}>PHOTOS / DOCUMENTS</div>
            <MediaGallery medias={selected.medias}/>
          </div>
        )}
        {!isFixed && (
          <button onClick={()=>{ if(window.confirm("Supprimer cet événement ?")) deleteEvent(selected); }}
            style={{width:"100%", background:"none", border:`1px solid ${C.border}`, borderRadius:10,
              padding:"11px", fontSize:12, fontWeight:700, color:"#E05260", cursor:"pointer", marginTop:8}}>
            🗑 Supprimer cet événement
          </button>
        )}
      </div>
    );
  }

  // Calcul des 3 prochains événements
  function parseFrDate(str) {
    if(!str) return null;
    const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(iso) return new Date(parseInt(iso[1]), parseInt(iso[2])-1, parseInt(iso[3]));
    const m2 = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(m2) return new Date(parseInt(m2[3]),parseInt(m2[2])-1,parseInt(m2[1]));
    const mo = {janvier:0,fevrier:1,"février":1,mars:2,avril:3,mai:4,juin:5,juillet:6,"août":7,aout:7,septembre:8,octobre:9,novembre:10,"décembre":11,decembre:11};
    const m = str.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
    if(m) { const mn = mo[m[2].toLowerCase()]; if(mn!==undefined) return new Date(parseInt(m[3]),mn,parseInt(m[1])); }
    return null;
  }

  const today = new Date(); today.setHours(0,0,0,0);
  const withDates = allEvents.map(e=>({...e, _d:parseFrDate(e.date)}));
  const upcoming = withDates.filter(e=>e._d && e._d>=today).sort((a,b)=>a._d-b._d).slice(0,3);
  const noDate   = allEvents.filter(e=>!parseFrDate(e.date));

  return (
    <div>
      <h2 style={{color:C.navy, fontWeight:800, fontSize:18, marginBottom:16}}>{"📅"} Agenda</h2>

      {allEvents.length===0 ? (
        <div style={{textAlign:"center", padding:"40px 20px", color:C.sub}}>
          <div style={{fontSize:48, marginBottom:12}}>{"📅"}</div>
          <div style={{fontSize:14, fontWeight:700, color:C.navy, marginBottom:6}}>Agenda vide</div>
          <div style={{fontSize:12}}>Ajoutez des événements depuis l'Éditeur de fiches</div>
        </div>
      ) : (
        <>
          {/* 3 prochaines dates */}
          {upcoming.length > 0 && (
            <div style={{marginBottom:20}}>
              <div style={{fontSize:11, fontWeight:800, color:C.sub, letterSpacing:.8, marginBottom:10}}>PROCHAINS ÉVÉNEMENTS</div>
              <div style={{display:"flex", flexDirection:"column", gap:8}}>
                {upcoming.map(ev=>(
                  <Card key={ev.id} onClick={()=>setSelected(ev)}>
                    <div style={{display:"flex", gap:12, alignItems:"center"}}>
                      <div style={{background:(ev.color||C.blue)+"22", borderRadius:12, width:44, height:44,
                        display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0}}>
                        {typeEmoji[ev.type]||"📅"}
                      </div>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontSize:13, fontWeight:700, color:C.text, marginBottom:3}}>{ev.title}</div>
                        <div style={{fontSize:11, color:C.sub}}>{"📆"} {(()=>{ const iso=ev.date&&ev.date.match(/^(\d{4})-(\d{2})-(\d{2})$/); return iso?`${iso[3]}/${iso[2]}/${iso[1]}`:ev.date; })()}</div>
                        {ev.heure && <div style={{fontSize:11, color:C.sub}}>{"🕐"} {ev.heure}</div>}
                      </div>
                      {ev.imageData && <span style={{fontSize:12}}>{"📎"}</span>}
                      <span style={{color:C.sub, fontSize:18}}>›</span>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Calendrier mensuel — toujours visible */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:11, fontWeight:800, color:C.sub, letterSpacing:.8, marginBottom:10}}>VUE MENSUELLE</div>
            <MiniCalendar key={allEvents.length + "-" + (allEvents[allEvents.length-1]?.id||0)} events={allEvents}/>
          </div>

          {/* Tous les événements (sans date connue + reste) */}
          {(noDate.length > 0 || allEvents.length > upcoming.length) && (
            <div>
              <div style={{fontSize:11, fontWeight:800, color:C.sub, letterSpacing:.8, marginBottom:10}}>TOUS LES ÉVÉNEMENTS</div>
              <div style={{display:"flex", flexDirection:"column", gap:8}}>
                {allEvents.map(ev=>(
                  <Card key={ev.id} onClick={()=>setSelected(ev)}>
                    <div style={{display:"flex", gap:12, alignItems:"center"}}>
                      <div style={{background:(ev.color||C.blue)+"22", borderRadius:12, width:40, height:40,
                        display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0}}>
                        {typeEmoji[ev.type]||"📅"}
                      </div>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontSize:13, fontWeight:700, color:C.text, marginBottom:2}}>{ev.title}</div>
                        <div style={{fontSize:11, color:C.sub}}>{"📆"} {(()=>{ const iso=ev.date&&ev.date.match(/^(\d{4})-(\d{2})-(\d{2})$/); return iso?`${iso[3]}/${iso[2]}/${iso[1]}`:ev.date; })()}</div>
                      </div>
                      {!AGENDA.some(a=>a.id===ev.id) && <span style={{fontSize:10, color:C.sub}}>✏️</span>}
                      <span style={{color:C.sub, fontSize:18}}>›</span>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const GESTES = [
  {
    id:0,
    title:"Cathéter sus-pubien",
    tags:["#urologie","#rétention","#sondage","#sus-pubien","#CSP"],
    color:"#2E7EAD",
    icon:"🩺",
    indications:"Il peut être réalisé d'emblée ou en cas de contre-indication à un sondage urinaire (traumatisme urétral, prostatite, sténose de l'urètre).\n\nIl peut être aussi réalisé en cas d'échec de sondage vésical dans le cas d'une volumineuse hypertrophie bénigne de la prostate.",
    contreIndications:[
      "L'absence de globe clinique",
      "Les troubles de l'hémostase ou la prise d'un traitement anticoagulant",
      "La présence d'une tumeur de vessie pouvant être suspectée devant une hématurie",
      "Un pontage vasculaire extra-anatomique",
      "Un antécédent chirurgical avec cicatrice sus-pubienne",
      "En cas d'hématurie macroscopique le CSP est à éviter : le calibre du cathéter étant plus petit que la sonde urinaire, le risque d'obstruction est plus fréquent",
    ],
    materiel:[
      "Kit cathéter sus-pubien (Cystofix® ou équivalent) — 12 à 14 Ch",
      "Echographe pour guidage et confirmation globe (si disponible)",
      "Antiseptique cutané (chlorhexidine alcoolique)",
      "Champ stérile + gants stériles",
      "Xylocaïne 1% + seringue 10 mL + aiguille IM",
      "Bistouri lame 15",
      "Aiguille de ponction + guide (technique de Seldinger selon kit)",
      "Seringue 20 mL pour vérification",
      "Pansement + système de fixation",
      "Poche de recueil urinaire",
    ],
    etapes:[
      "Confirmer le globe vésical : percussion (matité hypogastrique) + échographie si disponible",
      "Vérifier l'absence de cicatrice abdominale sous-ombilicale (risque d'anse grêle)",
      "Installer le patient en décubitus dorsal, vessie pleine (globe > 300 mL)",
      "Repérer le site : ligne médiane, 2 doigts (3 cm) au-dessus de la symphyse pubienne",
      "Antisepsie large de la zone hypogastrique",
      "Anesthésie locale plan par plan : peau, SC, fascia — aspirer régulièrement",
      "Confirmer la vessie : aspirer de l'urine avec l'aiguille IM avant de procéder",
      "Incision cutanée de 5 mm au bistouri sur le site anesthésié",
      "Introduire le trocart/aiguille de ponction perpendiculairement, légèrement dirigé vers le bas",
      "Dès l'aspiration d'urine franche : introduction du cathéter sur le guide (Seldinger) ou dans le trocart",
      "Retirer le mandrin/trocart, vérifier le débit urinaire libre",
      "Gonfler le ballonnet si présent (selon kit), tirer doucement pour ancrer",
      "Fixer le cathéter à la peau (point de suture ou système adhésif)",
      "Connecter à la poche de recueil, pansement occlusif",
      "Contrôle échographique post-pose si disponible",
    ],
    pieges:[
      "Ne jamais poser sans globe confirmé : risque de ponction d'anse grêle à vide",
      "Cicatrice sous-ombilicale = contre-indication relative forte : anses grêles adhérentes",
      "Toujours aspirer à l'aiguille IM avant l'incision pour confirmer la position vésicale",
      "Ne pas diriger le trocart vers le haut (risque de perforation péritonéale)",
      "Vidange progressive si globe > 500 mL : clamper 5 min toutes les 300 mL (risque hématurie ex-vacuo)",
      "Vérifier l'absence d'anticoagulants ou troubles de la coagulation avant geste",
    ],
    complications:[
      "Hématurie (souvent transitoire)",
      "Perforation d'anse grêle ou de péritoine",
      "Hématome de paroi",
      "Infection / cystite / cellulite",
      "Déplacement ou obstruction du cathéter",
      "Hématurie ex-vacuo (vidange trop rapide)",
    ],
    videoUrl:"https://www.youtube.com/watch?v=SEFo9R9VI-U",
  },
];




// - GestesScreen -
function GestesScreen({ deepLinkId }) {
  const C = useC();
  const { store } = useData();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState("indications");
  const { toggleFavori, isFavori } = useFavoris();

  const allGestes = [...GESTES, ...store.gestes];

  useEffect(()=>{ if(deepLinkId && allGestes.length){ const it=allGestes.find(x=>x.id===deepLinkId||x.id===Number(deepLinkId)); if(it) setSelected(it); } },[deepLinkId, store.gestes]);
  useEffect(()=>{ const el=document.querySelector('[data-content-scroll]'); if(el) el.scrollTop=0; },[selected]);

  const filtered = allGestes.filter(g => {
    const q = search.toLowerCase();
    if(!q) return true;
    return (g.title + (Array.isArray(g.tags)?g.tags:[]).join(" ") + (g.indications||"")).toLowerCase().includes(q);
  });

  if(selected) {
    const gesteToShow = allGestes.find(g=>g.id===selected.id)||selected;
    return <GesteDetail geste={gesteToShow} onBack={()=>{ setSelected(null); setActiveTab("indications"); }} activeTab={activeTab} setActiveTab={setActiveTab}/>;
  }

  return (
    <div style={{minHeight:"100vh"}}>
      <div style={{display:"flex", alignItems:"center", gap:12, marginBottom:20}}>
        <div style={{background:C.redLight, borderRadius:12, width:44, height:44,
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:22}}>{"✂️"}</div>
        <div>
          <div style={{fontSize:18, fontWeight:800, color:C.text}}>Gestes techniques</div>
          <div style={{fontSize:12, color:C.sub}}>{allGestes.length} fiches disponibles</div>
        </div>
      </div>

      {/* Barre de recherche */}
      <div style={{display:"flex", alignItems:"center", gap:10,
        background:C.white, border:`1px solid ${C.border}`,
        borderRadius:14, padding:"11px 14px", marginBottom:20}}>
        <span style={{fontSize:15, opacity:.5}}>{"🔍"}</span>
        <input
          value={search}
          onChange={e=>setSearch(e.target.value)}
          placeholder="Rechercher un geste, tag..."
          style={{flex:1, border:"none", outline:"none", fontSize:13,
            color:C.text, background:"transparent", fontFamily:"inherit"}}
        />
        {search && (
          <button onClick={()=>setSearch("")}
            style={{background:"none", border:"none", color:C.sub, cursor:"pointer", fontSize:15, padding:0}}>✕</button>
        )}
      </div>

      {/* Liste */}
      <div style={{display:"flex", flexDirection:"column", gap:10}}>
        {filtered.map(g => (
          <button key={g.id} onClick={()=>setSelected(g)}
            style={{background:C.white, border:`1px solid ${C.border}`,
              borderRadius:16, padding:"16px", cursor:"pointer", textAlign:"left",
              borderLeft:`4px solid ${g.color||C.blue}`,
              transition:"transform .1s"}}>
            <div style={{display:"flex", alignItems:"center", gap:12}}>
              <div style={{background:(g.color||C.blue)+"22", borderRadius:12,
                width:48, height:48, display:"flex", alignItems:"center",
                justifyContent:"center", fontSize:24, flexShrink:0}}>
                {g.icon||"✂️"}
              </div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:14, fontWeight:800, color:C.text, marginBottom:4}}>{g.title}</div>
                <div style={{display:"flex", gap:4, flexWrap:"wrap"}}>
                  {g.tags.slice(0,3).map(t=>(
                    <span key={t} style={{fontSize:10, fontWeight:700,
                      background:C.blue+"22", color:C.blue,
                      padding:"2px 7px", borderRadius:6}}>{t}</span>
                  ))}
                </div>
              </div>
              <span style={{color:C.sub, fontSize:18, flexShrink:0}}>›</span>
            </div>
          </button>
        ))}
        {filtered.length===0 && (
          <div style={{textAlign:"center", padding:"40px 20px", color:C.sub}}>
            <div style={{fontSize:36, marginBottom:10}}>🔍</div>
            <div style={{fontSize:14}}>Aucun geste pour "{search}"</div>
          </div>
        )}
      </div>
    </div>
  );
}

function GesteDetail({geste, onBack, activeTab, setActiveTab}) {
  const C = useC();
  const { toggleFavori, isFavori } = useFavoris();
  const tabs = [
    {id:"indications", label:"Indications", icon:"💊"},
    ...(geste.contreIndications?.length ? [{id:"ci", label:"Contre-ind.", icon:"🚫"}] : []),
    {id:"materiel",    label:"Matériel",    icon:"🧰"},
    {id:"etapes",      label:"Étapes",      icon:"📋"},
    {id:"pieges",      label:"Pièges",      icon:"⚠️"},
    {id:"compli",      label:"Compli.",     icon:"🚨"},
  ];

  const extractYoutubeId = url => {
    if(!url) return null;
    const m = url.match(/(?:embed\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  };
  const ytId = extractYoutubeId(geste.videoUrl);

  return (
    <div style={{minHeight:"100vh"}}>

      {/* Header */}
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16}}>
        <button onClick={onBack} style={{background:"none", border:"none", cursor:"pointer",
          display:"flex", alignItems:"center", gap:6, color:C.sub,
          fontWeight:700, fontSize:13, padding:0}}>
          ‹ <span>Retour</span>
        </button>
        <StarBtn filled={isFavori("geste",geste.id)} color={geste.color||C.red}
          onToggle={()=>toggleFavori({id:geste.id, type:"geste", title:geste.title, icon:geste.icon||"✂️", color:geste.color||C.red, nav:"gestes"})}/>
      </div>

      <div style={{background:C.white, borderRadius:16, padding:16, boxShadow:"0 2px 12px rgba(26,58,92,.07)",
        borderLeft:`4px solid ${geste.color||C.blue}`, marginBottom:16}}>
        <div style={{display:"flex", alignItems:"center", gap:12}}>
          <div style={{background:(geste.color||C.blue)+"22", borderRadius:12,
            width:52, height:52, display:"flex", alignItems:"center",
            justifyContent:"center", fontSize:28, flexShrink:0}}>
            {geste.icon||"✂️"}
          </div>
          <div>
            <div style={{fontSize:16, fontWeight:800, color:C.text, lineHeight:1.3}}>{geste.title}</div>
            <div style={{display:"flex", gap:4, flexWrap:"wrap", marginTop:5}}>
              {geste.tags.map(t=>(
                <span key={t} style={{fontSize:10, fontWeight:700,
                  background:C.blue+"22", color:C.blue,
                  padding:"2px 7px", borderRadius:6}}>{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Vidéo YouTube — lien direct */}
      {ytId && (
        <a
          href={`https://www.youtube.com/watch?v=${ytId}`}
          target="_blank"
          rel="noreferrer"
          style={{
            display:"flex", alignItems:"center", gap:14,
            background:C.white, border:`1px solid ${C.border}`,
            borderRadius:14, padding:"14px 16px", marginBottom:16,
            textDecoration:"none", boxShadow:"0 2px 8px rgba(26,58,92,.06)",
          }}>
          <div style={{
            background:"#FF0000", borderRadius:10,
            width:46, height:46, flexShrink:0,
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:13, fontWeight:800, color:C.text, marginBottom:2}}>Voir la vidéo</div>
            <div style={{fontSize:11, color:C.sub}}>Ouvre YouTube dans votre navigateur</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      )}

      {/* Image principale si disponible */}
      {geste.imageData && (
        <div style={{borderRadius:14, overflow:"hidden", marginBottom:geste.credit?4:16, background:"#f8f9fa", border:"1px solid #e0e0e0"}}>
          <ClickableImage src={geste.imageData || geste.imageUrl} alt={geste.title} style={{borderRadius:14}}/>
        </div>
      )}
      {geste.credit && (
        <div style={{fontSize:10, color:C.sub, fontStyle:"italic", marginBottom:16, paddingLeft:4}}>
          © {geste.credit}
        </div>
      )}
      {/* Galerie multi-médias */}
      {geste.medias?.length > 0 && <MediaGallery medias={geste.medias}/>}

      {/* Onglets de contenu */}
      <div style={{display:"flex", gap:4, marginBottom:16, overflowX:"auto", paddingBottom:4}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
            flexShrink:0, border:"none", borderRadius:10,
            padding:"7px 12px", cursor:"pointer", fontSize:11, fontWeight:700,
            background: activeTab===t.id ? (geste.color||C.blue) : C.white,
            color: activeTab===t.id ? "#fff" : C.sub,
            transition:"background .15s",
          }}>{t.icon} {t.label}</button>
        ))}
      </div>

      {/* Contenu de l'onglet */}
      <div style={{background:C.white, borderRadius:16,
        border:`1px solid ${C.border}`, overflow:"hidden"}}>

        {activeTab==="indications" && (
          <div style={{padding:16}}>
            <div style={{fontSize:12, fontWeight:800, color:C.sub,
              letterSpacing:.5, marginBottom:12}}>{"💊 INDICATIONS"}</div>
            <div style={{fontSize:14, color:C.text, lineHeight:1.7, whiteSpace:"pre-line"}}>
              {geste.indications}
            </div>
          </div>
        )}

        {activeTab==="ci" && (
          <div style={{padding:16}}>
            <div style={{fontSize:12, fontWeight:800, color:C.sub,
              letterSpacing:.5, marginBottom:12}}>{"🚫 CONTRE-INDICATIONS"}</div>
            <div style={{display:"flex", flexDirection:"column", gap:8}}>
              {(geste.contreIndications||[]).map((ci,i)=>(
                <div key={i} style={{
                  display:"flex", alignItems:"flex-start", gap:10,
                  background:C.redLight, borderRadius:10, padding:"10px 12px",
                  border:`1px solid ${C.red}30`,
                }}>
                  <span style={{fontSize:15, flexShrink:0, marginTop:1}}>{"🚫"}</span>
                  <div style={{fontSize:13, color:C.text, lineHeight:1.5}}>{ci}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab==="materiel" && (
          <div style={{padding:16}}>
            <div style={{fontSize:12, fontWeight:800, color:C.sub,
              letterSpacing:.5, marginBottom:12}}>{"🧰 MATÉRIEL"}</div>
            <div style={{display:"flex", flexDirection:"column", gap:8}}>
              {(geste.materiel||[]).map((item,i)=>(
                <div key={i} style={{display:"flex", alignItems:"flex-start", gap:10}}>
                  <div style={{background:C.blue+"22", borderRadius:6, padding:"2px 7px",
                    fontSize:11, fontWeight:800, color:C.blue, flexShrink:0, marginTop:1}}>
                    {i+1}
                  </div>
                  <div style={{fontSize:13, color:C.text, lineHeight:1.5}}>{item}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab==="etapes" && (
          <div style={{padding:0}}>
            <div style={{padding:"16px 16px 10px", fontSize:12, fontWeight:800,
              color:C.sub, letterSpacing:.5}}>{"📋 ÉTAPES"}</div>
            {(geste.etapes||[]).map((step,i)=>(
              <div key={i} style={{
                display:"flex", alignItems:"flex-start", gap:12,
                padding:"12px 16px",
                borderTop: i>0 ? `1px solid ${C.border}` : "none",
                background: i%2===0 ? "transparent" : C.blueLight+"80",
              }}>
                <div style={{
                  background: geste.color||C.blue,
                  borderRadius:"50%", width:26, height:26,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:12, fontWeight:800, color:"#fff", flexShrink:0, marginTop:1,
                }}>{i+1}</div>
                <div style={{fontSize:13, color:C.text, lineHeight:1.6, flex:1}}>{step}</div>
              </div>
            ))}
          </div>
        )}

        {activeTab==="pieges" && (
          <div style={{padding:16}}>
            <div style={{fontSize:12, fontWeight:800, color:C.sub,
              letterSpacing:.5, marginBottom:12}}>{"⚠️ POINTS CRITIQUES / PIÈGES"}</div>
            <div style={{display:"flex", flexDirection:"column", gap:10}}>
              {(geste.pieges||[]).map((p,i)=>(
                <div key={i} style={{
                  display:"flex", alignItems:"flex-start", gap:10,
                  background:"#E8A82E15", borderRadius:10, padding:"10px 12px",
                  border:"1px solid #E8A82E30",
                }}>
                  <span style={{fontSize:16, flexShrink:0}}>{"⚠️"}</span>
                  <div style={{fontSize:13, color:C.text, lineHeight:1.5}}>{p}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab==="compli" && (
          <div style={{padding:16}}>
            <div style={{fontSize:12, fontWeight:800, color:C.sub,
              letterSpacing:.5, marginBottom:12}}>{"🚨 COMPLICATIONS"}</div>
            <div style={{display:"flex", flexDirection:"column", gap:8}}>
              {(geste.complications||[]).map((c,i)=>(
                <div key={i} style={{
                  display:"flex", alignItems:"center", gap:10,
                  background:"#E74C3C15", borderRadius:10, padding:"9px 12px",
                  border:"1px solid #E74C3C30",
                }}>
                  <div style={{width:7, height:7, borderRadius:"50%",
                    background:"#E74C3C", flexShrink:0}}/>
                  <div style={{fontSize:13, color:C.text}}>{c}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ClickableImage : image cliquable plein écran avec zoom ──────────────────
function ClickableImage({ src, alt, style={}, darkBg=false }) {
  const [lightbox, setLightbox] = useState(false);
  return (
    <>
      <div onClick={()=>setLightbox(true)} style={{cursor:"zoom-in", position:"relative", display:"inline-block", width:"100%"}}>
        <img src={src} alt={alt||""} style={{width:"100%", display:"block", objectFit:"contain", ...style}}/>
        <div style={{position:"absolute", bottom:8, right:8, background:"rgba(0,0,0,.55)", borderRadius:6, padding:"3px 8px", fontSize:10, color:"#fff", display:"flex", alignItems:"center", gap:4, pointerEvents:"none"}}>
          <span>🔍</span><span>Agrandir</span>
        </div>
      </div>
      {lightbox && <ImageLightbox src={src} onClose={()=>setLightbox(false)}/>}
    </>
  );
}

// ── DiversImageViewer : affiche l'image complète + lightbox ─────────────────
function DiversImageViewer({ src, alt, isPdf, pdfData }) {
  const C = useC();
  if(isPdf) return (
    <div style={{borderRadius:12, overflow:"hidden", marginBottom:12}}>
      <a href={pdfData} target="_blank" rel="noreferrer" style={{display:"block", background:C.blueLight, borderRadius:12, padding:16, textAlign:"center", color:C.blue, fontWeight:700, fontSize:13, textDecoration:"none"}}>{"📂 Ouvrir le document"}</a>
    </div>
  );
  return (
    <div style={{borderRadius:12, overflow:"hidden", marginBottom:12, background:"#f8f9fa", border:"1px solid #e0e0e0"}}>
      <ClickableImage src={src} alt={alt} style={{borderRadius:12}}/>
    </div>
  );
}

// - DiversScreen -
function DiversScreen({ deepLinkId }) {
  const C = useC();
  const { store } = useData();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const { toggleFavori, isFavori } = useFavoris();

  const allDivers = [...DIVERS, ...store.divers];

  useEffect(()=>{ if(deepLinkId && allDivers.length){ const it=allDivers.find(x=>x.id===deepLinkId||x.id===Number(deepLinkId)); if(it) setSelected(it); } },[deepLinkId, store.divers]);
  useEffect(()=>{ if(selected){ const el=document.querySelector('[data-content-scroll]'); if(el) el.scrollTop=0; } },[selected]);

  const filtered = allDivers.filter(d =>
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    (Array.isArray(d.tags)?d.tags:d.tags?[d.tags]:[]).some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  if(selected) {
    return (
      <div>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4}}>
          <BackBtn onClick={()=>setSelected(null)}/>
          <StarBtn filled={isFavori("divers",selected.id)} color={C.navy}
            onToggle={()=>toggleFavori({id:selected.id, type:"divers", title:selected.title, icon:"⚡", color:C.navy, nav:"divers"})}/>
        </div>
        <h2 style={{color:C.navy, fontWeight:800, fontSize:17, marginBottom:12}}>{selected.title}</h2>
        <div style={{display:"flex", gap:6, flexWrap:"wrap", marginBottom:selected.source?8:16}}>
          {(Array.isArray(selected.tags)?selected.tags:[]).map(t => <Tag key={t} label={t} color={C.blue}/>)}
        </div>
        {selected.source && (
          <div style={{display:"flex", alignItems:"center", gap:6, marginBottom:12,
            background:C.blueLight, borderRadius:8, padding:"5px 10px"}}>
            <span style={{fontSize:12}}>{"🏥"}</span>
            <span style={{fontSize:11, color:C.navy, fontWeight:700}}>{selected.source}</span>
          </div>
        )}
        {selected.imageData && (
          <DiversImageViewer src={selected.imageData||selected.imageUrl} alt={selected.title} isPdf={selected.imageUrl&&selected.imageUrl.endsWith(".pdf")} pdfData={selected.imageData||selected.imageUrl}/>
        )}
        {selected.credit && (
          <div style={{fontSize:10, color:C.sub, fontStyle:"italic", marginBottom:8, paddingLeft:2}}>
            © {selected.credit}
          </div>
        )}
        <Card>
          <pre style={{fontSize:13, color:C.text, margin:0, whiteSpace:"pre-wrap", fontFamily:"inherit", lineHeight:1.7}}>{selected.content}</pre>
        </Card>
        {selected.medias?.length > 0 && (
          <div style={{marginTop:12}}>
            <div style={{fontSize:11, fontWeight:800, color:C.navy, marginBottom:8}}>DOCUMENTS / IMAGES</div>
            <MediaGallery medias={selected.medias}/>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <h2 style={{color:C.navy, fontWeight:800, fontSize:18, marginBottom:16}}>{"⚡"} Base de connaissances</h2>
      <div style={{display:"flex", alignItems:"center", gap:10, background:C.white, border:`1px solid ${C.border}`, borderRadius:12, padding:"10px 14px", marginBottom:16}}>
        <span style={{fontSize:14, opacity:.5}}>{"🔍"}</span>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher ou #hashtag..."
          style={{flex:1, border:"none", outline:"none", fontSize:13, color:C.text, background:"transparent", fontFamily:"inherit"}}/>
        {search && <button onClick={()=>setSearch("")} style={{background:"none", border:"none", cursor:"pointer", color:C.sub, fontSize:16, lineHeight:1, padding:0, flexShrink:0}}>✕</button>}
      </div>
      <div style={{display:"flex", flexDirection:"column", gap:10}}>
        {filtered.map(d => (
          <Card key={d.id} onClick={()=>setSelected(d)}>
            <div style={{display:"flex", gap:10, alignItems:"center", marginBottom:6}}>
              {d.schema && <div style={{background:C.redLight, borderRadius:8, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0}}>{"💉"}</div>}
              <div style={{fontWeight:700, color:C.text}}>{d.title}</div>
            </div>
            <div style={{display:"flex", gap:6, flexWrap:"wrap", alignItems:"center"}}>
              {(Array.isArray(d.tags)?d.tags:[]).map(t => <Tag key={t} label={t} color={C.navy}/>)}
              {d.imageData && <span style={{fontSize:11, color:C.sub}}>{"📎"}</span>}
              {d.schema && <Tag label="Schema" color={C.red}/>}
              {d.source && <span style={{fontSize:10, color:C.sub, fontStyle:"italic"}}>{"🏥"} {d.source}</span>}
            </div>
          </Card>
        ))}
        {filtered.length===0 && allDivers.length===0 && (
          <div style={{textAlign:"center", padding:"40px 20px", color:C.sub}}>
            <div style={{fontSize:48, marginBottom:12}}>{"📝"}</div>
            <div style={{fontSize:14, fontWeight:700, color:C.navy, marginBottom:6}}>Aucune fiche pour le moment</div>
            <div style={{fontSize:12, lineHeight:1.5}}>Ajoutez vos fiches depuis l'Éditeur de fiches</div>
          </div>
        )}
        {filtered.length===0 && allDivers.length>0 && <div style={{textAlign:"center", color:C.sub, padding:30, fontSize:13}}>Aucun resultat</div>}
      </div>
    </div>
  );
}

// - AnnuaireScreen -
function AnnuaireScreen() {
  const C = useC();
  const { store } = useData();
  const [search, setSearch]     = useState("");
  const [filterCat, setFilterCat] = useState("Tous");
  const [selected, setSelected] = useState(null);

  const contacts = store.contacts;

  useEffect(()=>{ if(selected){ const el=document.querySelector('[data-content-scroll]'); if(el) el.scrollTop=0; } },[selected]);

  const cats = ["Tous", ...Array.from(new Set(contacts.map(p=>p.categorie||"Autre").filter(Boolean)))];

  const filtered = contacts.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.nom.toLowerCase().includes(q) || (p.role||"").toLowerCase().includes(q) || (p.tel||"").includes(q);
    const matchCat = filterCat==="Tous" || (p.categorie||"Autre")===filterCat;
    return matchSearch && matchCat;
  });

  if(selected) {
    return (
      <div>
        <BackBtn onClick={()=>setSelected(null)}/>
        <div style={{background:C.navy, borderRadius:14, padding:20, color:"#fff", marginBottom:16}}>
          <div style={{fontSize:32, marginBottom:8}}>{"👤"}</div>
          <div style={{fontSize:18, fontWeight:800}}>{selected.nom}</div>
          {selected.role && <div style={{fontSize:13, opacity:.8, marginTop:4}}>{selected.role}</div>}
          {selected.categorie && <div style={{marginTop:8}}><Tag label={selected.categorie} color={C.blue}/></div>}
        </div>

        {/* Téléphones cliquables */}
        {(selected.telephones||[]).map((t,i)=>(
          <Card key={i} style={{marginBottom:10}}>
            <div style={{display:"flex", gap:12, alignItems:"center"}}>
              <div style={{background:C.greenLight, borderRadius:10, width:40, height:40, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20}}>{"📞"}</div>
              <div style={{flex:1}}>
                {t.label && <div style={{fontSize:11, color:C.sub, marginBottom:2}}>{t.label}</div>}
                <a href={`tel:${t.numero}`} style={{fontSize:16, fontWeight:800, color:C.navy, textDecoration:"none"}}>{t.numero}</a>
              </div>
              <a href={`tel:${t.numero}`} style={{background:C.green, color:"#fff", borderRadius:10, padding:"8px 16px", fontSize:13, fontWeight:700, textDecoration:"none"}}>
                📞 Appeler
              </a>
            </div>
          </Card>
        ))}

        {/* Rétrocompat : ancien champ tel unique */}
        {!selected.telephones && selected.tel && (
          <Card style={{marginBottom:10}}>
            <div style={{display:"flex", gap:12, alignItems:"center"}}>
              <div style={{background:C.greenLight, borderRadius:10, width:40, height:40, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20}}>{"📞"}</div>
              <div style={{flex:1}}>
                <a href={`tel:${selected.tel}`} style={{fontSize:16, fontWeight:800, color:C.navy, textDecoration:"none"}}>{selected.tel}</a>
              </div>
              <a href={`tel:${selected.tel}`} style={{background:C.green, color:"#fff", borderRadius:10, padding:"8px 16px", fontSize:13, fontWeight:700, textDecoration:"none"}}>
                📞 Appeler
              </a>
            </div>
          </Card>
        )}

        {selected.notes && (
          <Card>
            <div style={{fontSize:11, fontWeight:700, color:C.sub, marginBottom:4}}>NOTES</div>
            <div style={{fontSize:13, color:C.text, lineHeight:1.5}}>{selected.notes}</div>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div>
      <h2 style={{color:C.navy, fontWeight:800, fontSize:18, marginBottom:16}}>{"📒"} Contacts</h2>

      {/* Barre recherche */}
      <div style={{display:"flex", alignItems:"center", gap:10, background:C.white, border:`1px solid ${C.border}`, borderRadius:12, padding:"10px 14px", marginBottom:12}}>
        <span style={{fontSize:14, opacity:.5}}>{"🔍"}</span>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Rechercher un contact..."
          style={{flex:1, border:"none", outline:"none", fontSize:13, color:C.text, background:"transparent", fontFamily:"inherit"}}/>
        {search && <button onClick={()=>setSearch("")} style={{background:"none", border:"none", cursor:"pointer", color:C.sub, fontSize:16, lineHeight:1, padding:0}}>✕</button>}
      </div>

      {/* Filtre catégorie */}
      {cats.length > 1 && (
        <div style={{display:"flex", gap:6, overflowX:"auto", paddingBottom:8, marginBottom:12}}>
          {cats.map(c => (
            <button key={c} onClick={()=>setFilterCat(c)} style={{
              background: filterCat===c ? C.blue : C.blueLight,
              color: filterCat===c ? "#fff" : C.blue,
              border:"none", borderRadius:20, padding:"5px 12px", fontSize:10, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap"
            }}>{c}</button>
          ))}
        </div>
      )}

      {/* Liste */}
      {contacts.length === 0 ? (
        <div style={{textAlign:"center", padding:"50px 20px", color:C.sub}}>
          <div style={{fontSize:48, marginBottom:12}}>{"📒"}</div>
          <div style={{fontSize:14, fontWeight:700, color:C.navy, marginBottom:6}}>Aucun contact</div>
          <div style={{fontSize:12, lineHeight:1.5}}>Ajoutez vos contacts depuis l'Éditeur de fiches</div>
        </div>
      ) : (
        <div style={{display:"flex", flexDirection:"column", gap:8}}>
          {filtered.map(p => {
            const tel1 = p.telephones?.[0]?.numero || p.tel;
            return (
              <Card key={p.id} onClick={()=>setSelected(p)} style={{padding:12}}>
                <div style={{display:"flex", alignItems:"center", gap:10}}>
                  <div style={{background:C.blueLight, borderRadius:10, width:40, height:40, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, color:C.blue, fontSize:15, flexShrink:0}}>
                    {(p.nom[0]||"?").toUpperCase()}
                  </div>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:13, fontWeight:700, color:C.text, marginBottom:2}}>{p.nom}</div>
                    {p.role && <div style={{fontSize:11, color:C.sub, marginBottom:2}}>{p.role}</div>}
                    {tel1 && <div style={{fontSize:12, color:C.blue, fontWeight:600}}>{tel1}{p.telephones?.length>1 ? ` +${p.telephones.length-1}`:""}</div>}
                  </div>
                  {tel1 && (
                    <a href={`tel:${tel1}`} onClick={e=>e.stopPropagation()}
                      style={{background:C.green, color:"#fff", borderRadius:10, padding:"8px 12px", fontSize:16, textDecoration:"none", flexShrink:0}}>
                      {"📞"}
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
          {filtered.length===0 && <div style={{textAlign:"center", color:C.sub, padding:30, fontSize:13}}>Aucun résultat</div>}
        </div>
      )}
    </div>
  );
}


// ─── DilutionScreen ───────────────────────────────────────────────────────────
function DilutionScreen({ deepLinkId }) {
  const C = useC();
  const { store } = useData();
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const { toggleFavori, isFavori } = useFavoris();

  const allDilutions = [...DILUTIONS, ...store.dilutions];

  useEffect(()=>{ if(deepLinkId && allDilutions.length){ const it=allDilutions.find(x=>x.id===deepLinkId||x.id===Number(deepLinkId)); if(it) setSelected(it); } },[deepLinkId, store.dilutions]);
  useEffect(()=>{ if(selected){ const el=document.querySelector('[data-content-scroll]'); if(el) el.scrollTop=0; } },[selected]);

  const filtered = allDilutions.filter(d =>
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    (Array.isArray(d.tags)?d.tags:[]).some(t=>t.toLowerCase().includes(search.toLowerCase()))
  );

  if(selected) {
    const sections = [
      { key:"presentation",    label:"Présentation",          icon:"💊", color:C.navy },
      { key:"indication",      label:"Indications",            icon:"🎯", color:C.amber },
      { key:"dilutionStandard",label:"Dilution standard",      icon:"🧪", color:C.blue },
      { key:"administration",  label:"Administration",         icon:"🩺", color:C.red },
      // Rétrocompatibilité anciens champs
      { key:"debitDepart",     label:"Débit de départ",       icon:"⏱️", color:C.green },
      { key:"voieAdmin",       label:"Voie d'administration",  icon:"🩺", color:C.red },
    ];

    return (
      <div>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4}}>
          <BackBtn onClick={()=>setSelected(null)}/>
          <StarBtn filled={isFavori("dilution",selected.id)} color={selected.color||C.red}
            onToggle={()=>toggleFavori({id:selected.id, type:"dilution", title:selected.title, icon:"💉", color:selected.color||C.red, nav:"dilutions"})}/>
        </div>

        {/* Header */}
        <div style={{
          background:`linear-gradient(135deg, ${selected.color} 0%, ${selected.color}CC 100%)`,
          borderRadius:18, padding:20, marginBottom:20, color:"#fff"
        }}>
          <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:8}}>
            <span style={{fontSize:28}}>{"💉"}</span>
            <div>
              <div style={{fontSize:19, fontWeight:800, lineHeight:1.2}}>{selected.title}</div>
              {selected.nomCommercial && <div style={{fontSize:13, opacity:.9, marginTop:2, fontStyle:"italic"}}>{selected.nomCommercial}</div>}
              {selected.subtitle && <div style={{fontSize:12, opacity:.75, marginTop:2}}>{selected.subtitle}</div>}
            </div>
          </div>
          <div style={{display:"flex", gap:6, flexWrap:"wrap", marginTop:6}}>
            {(Array.isArray(selected.tags)?selected.tags:[]).map(t=>(
              <span key={t} style={{background:"rgba(255,255,255,.2)", borderRadius:20, padding:"2px 10px", fontSize:10, fontWeight:700}}>{t}</span>
            ))}
          </div>
        </div>

        {/* Schema visuel uploadé */}
        {selected.schemaData && (
          <div style={{marginBottom:16}}>
            <div style={{display:"flex", alignItems:"center", gap:7, marginBottom:8}}>
              <div style={{background:C.blue+"18", borderRadius:10, width:34, height:34,
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:17}}>{"📊"}</div>
              <span style={{fontSize:12, fontWeight:800, color:C.blue, letterSpacing:.5, textTransform:"uppercase"}}>Schéma visuel</span>
            </div>
            <div style={{background:"#0A1628", borderRadius:14, padding:4, overflow:"hidden"}}>
              <ClickableImage src={selected.schemaData} alt="Schema de dilution" style={{borderRadius:10}}/>
            </div>
          </div>
        )}

        {/* Sections */}
        {sections.map(s => selected[s.key] ? (
          <div key={s.key} style={{marginBottom:12}}>
            <div style={{display:"flex", alignItems:"center", gap:7, marginBottom:7}}>
              <div style={{
                background:s.color+"18", borderRadius:10, width:34, height:34,
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0
              }}>{s.icon}</div>
              <span style={{fontSize:12, fontWeight:800, color:s.color, letterSpacing:.5, textTransform:"uppercase"}}>{s.label}</span>
            </div>
            <div style={{
              background:C.white, borderRadius:14, padding:14,
              border:`1.5px solid ${s.color}30`,
              borderLeft:`4px solid ${s.color}`,
              boxShadow:"0 2px 8px rgba(26,58,92,.05)"
            }}>
              <pre style={{fontSize:13, color:C.text, margin:0, whiteSpace:"pre-wrap", fontFamily:"inherit", lineHeight:1.75}}>
                {selected[s.key]}
              </pre>
            </div>
          </div>
        ) : null)}

        {/* Alerte voie si VVC */}
        {((selected.administration||"")+(selected.voieAdmin||"")).toLowerCase().includes("central") && (
          <div style={{
            background:C.redLight, border:`2px solid ${C.red}`, borderRadius:14, padding:14, marginTop:4
          }}>
            <div style={{display:"flex", alignItems:"center", gap:8}}>
              <span style={{fontSize:22}}>{"⚠️"}</span>
              <div>
                <div style={{fontSize:12, fontWeight:800, color:C.red}}>ATTENTION</div>
                <div style={{fontSize:12, color:C.text, marginTop:2}}>Voie veineuse centrale obligatoire. Ne pas administrer en périphérique.</div>
              </div>
            </div>
          </div>
        )}

        {/* Photo complémentaire */}
        {selected.photoData && (
          <div style={{marginTop:16, marginBottom:12}}>
            <div style={{display:"flex", alignItems:"center", gap:7, marginBottom:8}}>
              <div style={{background:C.navy+"18", borderRadius:10, width:34, height:34,
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:17}}>{"📷"}</div>
              <span style={{fontSize:12, fontWeight:800, color:C.navy, letterSpacing:.5, textTransform:"uppercase"}}>Photo</span>
            </div>
            <ClickableImage src={selected.photoData} alt="Photo" style={{borderRadius:12}}/>
          </div>
        )}
        {selected.medias?.length > 0 && (
          <div style={{marginTop:16}}>
            <div style={{fontSize:11, fontWeight:800, color:C.blue, marginBottom:8, letterSpacing:.5}}>SCHÉMAS SUPPLÉMENTAIRES</div>
            <MediaGallery medias={selected.medias}/>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex", alignItems:"center", gap:12, marginBottom:20}}>
        <div style={{background:C.redLight, borderRadius:14, width:48, height:48,
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0}}>
          {"💉"}
        </div>
        <div>
          <div style={{fontSize:18, fontWeight:800, color:C.text}}>Dilutions</div>
          <div style={{fontSize:12, color:C.sub}}>{allDilutions.length} fiche{allDilutions.length>1?"s":""} disponible{allDilutions.length>1?"s":""}</div>
        </div>
      </div>

      {/* Recherche */}
      <div style={{display:"flex", alignItems:"center", gap:10,
        background:C.white, border:`1px solid ${C.border}`,
        borderRadius:14, padding:"11px 14px", marginBottom:20}}>
        <span style={{fontSize:15, opacity:.5}}>{"🔍"}</span>
        <input
          value={search}
          onChange={e=>setSearch(e.target.value)}
          placeholder="Rechercher une dilution, tag..."
          style={{flex:1, border:"none", outline:"none", fontSize:13,
            color:C.text, background:"transparent", fontFamily:"inherit"}}
        />
        {search && (
          <button onClick={()=>setSearch("")}
            style={{background:"none", border:"none", color:C.sub, cursor:"pointer", fontSize:15, padding:0}}>✕</button>
        )}
      </div>

      {/* Liste */}
      <div style={{display:"flex", flexDirection:"column", gap:10}}>
        {filtered.map(d=>(
          <button key={d.id} onClick={()=>setSelected(d)}
            style={{background:C.white, border:`1px solid ${C.border}`,
              borderRadius:16, padding:"16px", cursor:"pointer", textAlign:"left",
              borderLeft:`4px solid ${d.color||C.red}`}}>
            <div style={{display:"flex", alignItems:"center", gap:12}}>
              <div style={{
                background:(d.color||C.red)+"22", borderRadius:12, width:48, height:48,
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0
              }}>{"💉"}</div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:14, fontWeight:800, color:C.text, marginBottom:4}}>{d.title}</div>
                {d.subtitle && <div style={{fontSize:11, color:C.sub, marginBottom:5}}>{d.subtitle}</div>}
                <div style={{display:"flex", gap:4, flexWrap:"wrap"}}>
                  {(Array.isArray(d.tags)?d.tags:[]).slice(0,3).map(t=>(
                    <span key={t} style={{fontSize:10, fontWeight:700,
                      background:(d.color||C.red)+"22", color:d.color||C.red,
                      padding:"2px 7px", borderRadius:6}}>{t}</span>
                  ))}
                  {d.schema && <span style={{fontSize:10, fontWeight:700,
                    background:C.blueLight, color:C.blue,
                    padding:"2px 7px", borderRadius:6}}>{"📊 Schema"}</span>}
                  {d.schemaUrl && !d.schema && <span style={{fontSize:10, fontWeight:700,
                    background:C.blueLight, color:C.blue,
                    padding:"2px 7px", borderRadius:6}}>{"📊 Schema"}</span>}
                </div>
              </div>
              <span style={{color:C.sub, fontSize:18, flexShrink:0}}>›</span>
            </div>
          </button>
        ))}
        {filtered.length===0 && allDilutions.length===0 && (
          <div style={{textAlign:"center", padding:"50px 20px", color:C.sub}}>
            <div style={{fontSize:52, marginBottom:12}}>{"💉"}</div>
            <div style={{fontSize:15, fontWeight:700, color:C.navy, marginBottom:8}}>Aucune dilution pour le moment</div>
            <div style={{fontSize:12, lineHeight:1.6}}>Ajoutez des fiches dilution depuis l'Éditeur de fiches</div>
          </div>
        )}
        {filtered.length===0 && allDilutions.length>0 && (
          <div style={{textAlign:"center", color:C.sub, padding:30, fontSize:13}}>Aucun resultat pour "{search}"</div>
        )}
      </div>
    </div>
  );
}


// ─── AdminScreen ───────────────────────────────────────────────────────────────
function AdminScreen({ onNewItem }) {
  const C = useC();
  const { store, addItem, updateItem, removeItem } = useData();
  const [tab, setTab] = useState("ecg");
  const [saved, setSaved] = useState(null);
  const [eForm, setEForm] = useState({ title:"", context:"", question:"", interpretation:"", diagnosis:"", points:"", imageUrl:"", imageData:null, medias:[], tags:"" });
  const [iForm, setIForm] = useState({ title:"", type:"Scanner", context:"", question:"", diag:"", imageUrl:"", imageData:null, medias:[], tags:"" });
  const [aForm, setAForm] = useState({ title:"", type:"formation", date:"", heure:"", lieu:"", description:"", imageUrl:"", imageData:null, medias:[], tags:"" });
  const [dForm, setDForm] = useState({ title:"", tags:"", content:"", imageUrl:"", imageData:null, credit:"", medias:[] });
  const [dilForm, setDilForm] = useState({ title:"", nomCommercial:"", subtitle:"", color:"#E05260", tags:"", presentation:"", indication:"", dilutionStandard:"", administration:"", schemaUrl:"", schemaData:null, photoUrl:"", photoData:null, medias:[] });
  const [gForm, setGForm] = useState({ title:"", icon:"✂️", color:"#C0392B", tags:"", indications:"", materiel:"", etapes:"", pieges:"", complications:"", videoUrl:"", credit:"", imageUrl:"", imageData:null, medias:[] });
  const [rForm, setRForm] = useState({ type:"retex", title:"", author:"", date:"", lieu:"", contexte:"", situation:"", bien:"", difficultes:"", amelio:"", takehome:"", recit:"", tags:"", medias:[] });

  const [editingE, setEditingE] = useState(null);
  const [editingI, setEditingI] = useState(null);
  const [editingA, setEditingA] = useState(null);
  const [editingD, setEditingD] = useState(null);
  const [editingDil, setEditingDil] = useState(null);
  const [editingG, setEditingG] = useState(null);

  // Contacts gardent leur propre state
  const [cForm, setCForm] = useState({ nom:"", categorie:"", role:"", telephones:[{label:"", numero:""}] });
  const [editingC, setEditingC] = useState(null);

  // Les listes viennent du DataStore global
  const customEcgs = store.ecgs;
  const customImagerie = store.imagerie;
  const customAgenda = store.agenda;
  const customDivers = store.divers;
  const customDilutions = store.dilutions;
  const customGestes = store.gestes;
  const customRetex = store.retex;
  const customContacts = store.contacts;

  function showSaved(msg) { setSaved(msg); setTimeout(()=>setSaved(null), 2500); }


  async function addEcg() {
    if(!eForm.title.trim()) return;
    const tags = eForm.tags.split(/[\s,]+/).filter(Boolean).map(t=>t.startsWith("#")?t:"#"+t);
    const points = typeof eForm.points==="string"?eForm.points.split("\n").filter(Boolean):eForm.points;
    if(editingE !== null) {
      const item = {...eForm, id:editingE, tags, points, color:"#E05260"};
      await updateItem("ecgs","admin_ecgs",item,["image"]);
      setEditingE(null); setEForm({title:"",context:"",question:"",interpretation:"",diagnosis:"",points:"",imageUrl:"",imageData:null,medias:[],tags:""});
      showSaved("ECG modifié !");
    } else {
      const item = {...eForm, id:Date.now(), tags, points, revealed:false, color:"#E05260"};
      await addItem("ecgs","admin_ecgs",item,["image"]);
      setEForm({title:"",context:"",question:"",interpretation:"",diagnosis:"",points:"",imageUrl:"",imageData:null,medias:[],tags:""});
      showSaved("ECG ajouté !");
      if(onNewItem) onNewItem({id:item.id,title:item.title,icon:"❤️",color:"#E05260",nav:"ecg"});
    }
  }

  async function addImagerie() {
    if(!iForm.title.trim()) return;
    const tags = iForm.tags.split(/[\s,]+/).filter(Boolean).map(t=>t.startsWith("#")?t:"#"+t);
    if(editingI !== null) {
      const item = {...iForm, id:editingI, tags, color:"#9B59B6"};
      await updateItem("imagerie","admin_imagerie",item,["image"]);
      setEditingI(null); setIForm({title:"",type:"Scanner",context:"",question:"",diag:"",imageUrl:"",imageData:null,medias:[],tags:""});
      showSaved("Cas modifié !");
    } else {
      const item = {...iForm, id:Date.now(), tags, revealed:false, color:"#9B59B6"};
      await addItem("imagerie","admin_imagerie",item,["image"]);
      setIForm({title:"",type:"Scanner",context:"",question:"",diag:"",imageUrl:"",imageData:null,medias:[],tags:""});
      showSaved("Cas ajouté !");
      if(onNewItem) onNewItem({id:item.id,title:item.title,icon:"🩻",color:"#9B59B6",nav:"imagerie"});
    }
  }

  async function addAgenda() {
    if(!aForm.title.trim()||!aForm.date.trim()) return;
    const colors = {formation:C.blue,reunion:C.green,congres:C.navy,soiree:C.amber,autre:"#8B5CF6"};
    const tags = aForm.tags.split(/[\s,]+/).filter(Boolean).map(t=>t.startsWith("#")?t:"#"+t);
    if(editingA !== null) {
      const item = {...aForm, id:editingA, tags, color:colors[aForm.type]||C.blue};
      await updateItem("agenda","admin_agenda",item,["image"]);
      setEditingA(null); setAForm({title:"",type:"formation",date:"",heure:"",lieu:"",description:"",imageUrl:"",imageData:null,medias:[],tags:""});
      showSaved("Événement modifié !");
    } else {
      const item = {...aForm, id:Date.now(), tags, color:colors[aForm.type]||C.blue};
      await addItem("agenda","admin_agenda",item,["image"]);
      setAForm({title:"",type:"formation",date:"",heure:"",lieu:"",description:"",imageUrl:"",imageData:null,medias:[],tags:""});
      showSaved("Événement ajouté !");
      if(onNewItem) onNewItem({id:item.id,title:item.title,icon:"📅",color:"#E8A82E",nav:"agenda"});
    }
  }

  async function addDivers() {
    if(!dForm.title.trim()) return;
    const tags = dForm.tags.split(/[\s,]+/).filter(Boolean).map(t=>t.startsWith("#")?t:"#"+t);
    if(editingD !== null) {
      const item = {...dForm, id:editingD, tags};
      await updateItem("divers","admin_divers",item,["image"]);
      setEditingD(null); setDForm({title:"",tags:"",content:"",imageUrl:"",imageData:null,credit:"",medias:[]});
      showSaved("Fiche modifiée !");
    } else {
      const item = {...dForm, id:Date.now(), tags};
      await addItem("divers","admin_divers",item,["image"]);
      setDForm({title:"",tags:"",content:"",imageUrl:"",imageData:null,credit:"",medias:[]});
      showSaved("Fiche ajoutée !");
      if(onNewItem) onNewItem({id:item.id,title:item.title,icon:"⚡",color:"#1A3A5C",nav:"divers"});
    }
  }

  async function addRetex() {
    if(!rForm.title.trim()) return;
    const tags = (rForm.tags||"").split(/[\s,]+/).filter(Boolean).map(t=>t.startsWith("#")?t:"#"+t);
    const item = {...rForm, tags, id:Date.now(), ts:Date.now(), reactions:{}, comments:[], date:rForm.date||new Date().toLocaleDateString("fr-FR")};
    await addRetexItem(item);
    setRForm({type:"retex",title:"",author:"",date:"",lieu:"",contexte:"",situation:"",bien:"",difficultes:"",amelio:"",takehome:"",recit:"",tags:"",medias:[]});
    showSaved("Publication ajoutée !");
    if(onNewItem) onNewItem({id:item.id,title:item.title,icon:"🔬",color:"#2E9E6B",nav:"retex"});
  }

  async function addGeste() {
    if(!gForm.title.trim()) return;
    const tags = gForm.tags.split(/[\s,]+/).filter(Boolean).map(t=>t.startsWith("#")?t:"#"+t);
    const parsed = {
      materiel: typeof gForm.materiel==="string"?gForm.materiel.split("\n").filter(Boolean):gForm.materiel,
      etapes:   typeof gForm.etapes==="string"?gForm.etapes.split("\n").filter(Boolean):gForm.etapes,
      pieges:   typeof gForm.pieges==="string"?gForm.pieges.split("\n").filter(Boolean):gForm.pieges,
      complications:typeof gForm.complications==="string"?gForm.complications.split("\n").filter(Boolean):gForm.complications,
    };
    if(editingG !== null) {
      const item = {...gForm, id:editingG, tags, ...parsed};
      await updateItem("gestes","admin_gestes",item,["image"]);
      setEditingG(null); setGForm({title:"",icon:"✂️",color:"#C0392B",tags:"",indications:"",materiel:"",etapes:"",pieges:"",complications:"",videoUrl:"",credit:"",imageUrl:"",imageData:null,medias:[]});
      showSaved("Geste modifié !");
    } else {
      const item = {...gForm, id:Date.now(), tags, ...parsed};
      await addItem("gestes","admin_gestes",item,["image"]);
      setGForm({title:"",icon:"✂️",color:"#C0392B",tags:"",indications:"",materiel:"",etapes:"",pieges:"",complications:"",videoUrl:"",credit:"",imageUrl:"",imageData:null,medias:[]});
      showSaved("Geste ajouté !");
      if(onNewItem) onNewItem({id:item.id,title:item.title,icon:item.icon||"✂️",color:item.color||"#C0392B",nav:"gestes"});
    }
  }

  async function addDilution() {
    if(!dilForm.title.trim()) return;
    const tags = dilForm.tags.split(/[\s,]+/).filter(Boolean).map(t=>t.startsWith("#")?t:"#"+t);
    if(editingDil !== null) {
      const item = {...dilForm, id:editingDil, tags, color:dilForm.color||"#E05260"};
      await updateItem("dilutions","admin_dilutions",item,["schema","photo"]);
      setEditingDil(null); setDilForm({title:"",nomCommercial:"",subtitle:"",color:"#E05260",tags:"",presentation:"",indication:"",dilutionStandard:"",administration:"",schemaUrl:"",schemaData:null,photoUrl:"",photoData:null,medias:[]});
      showSaved("Dilution modifiée !");
    } else {
      const item = {...dilForm, id:Date.now(), tags, color:dilForm.color||"#E05260"};
      await addItem("dilutions","admin_dilutions",item,["schema","photo"]);
      setDilForm({title:"",nomCommercial:"",subtitle:"",color:"#E05260",tags:"",presentation:"",indication:"",dilutionStandard:"",administration:"",schemaUrl:"",schemaData:null,photoUrl:"",photoData:null,medias:[]});
      showSaved("Dilution ajoutée !");
      if(onNewItem) onNewItem({id:item.id,title:item.title,icon:"💉",color:item.color||"#E05260",nav:"dilutions"});
    }
  }

  async function deleteItem(storeKey, storageKey, id, setter) {
    if(setter) {
      setter(prev => { const n=prev.filter(x=>x.id!==id); safeSet(storageKey,JSON.stringify(n)); return n; });
    } else {
      await removeItem(storeKey, storageKey, id);
    }
    showSaved("Supprimé !");
  }

  const inp = {width:"100%",border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",fontSize:13,color:C.text,background:"#fff",boxSizing:"border-box",marginBottom:10,outline:"none"};
  const lbl = {fontSize:11,fontWeight:700,color:C.sub,marginBottom:4,display:"block"};

  return (
    <div>
      <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:20}}>
        <span style={{fontSize:24}}>{"🗂️"}</span>
        <div>
          <div style={{fontSize:18, fontWeight:800, color:C.navy}}>Éditeur de fiches</div>
          <div style={{fontSize:12, color:C.sub}}>Gérer le contenu de l'application</div>
        </div>
      </div>

      {saved && (
        <div style={{background:C.greenLight, border:`1px solid ${C.green}`, borderRadius:10, padding:"10px 16px", marginBottom:16, fontSize:13, fontWeight:700, color:C.green, textAlign:"center"}}>
          {saved}
        </div>
      )}

      <div style={{display:"flex", gap:6, marginBottom:20, background:"#eef2f7", borderRadius:12, padding:4, overflowX:"auto", WebkitOverflowScrolling:"touch", scrollbarWidth:"none"}}>
        {[{id:"ecg",label:"❤️ ECG"},{id:"imagerie",label:"🩻 Imagerie"},{id:"retex",label:"🔬 RETEX"},{id:"agenda",label:"📅 Agenda"},{id:"divers",label:"⚡ Divers"},{id:"gestes",label:"✂️ Urgents"},{id:"dilutions",label:"💉 Dilutions"},{id:"annuaire",label:"📒 Contacts"}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            flexShrink:0, border:"none", borderRadius:9, padding:"8px 10px", cursor:"pointer",
            background:tab===t.id?C.white:"transparent",
            color:tab===t.id?C.navy:C.sub,
            fontWeight:tab===t.id?800:600, fontSize:11,
            boxShadow:tab===t.id?"0 1px 6px rgba(0,0,0,.08)":"none",
            whiteSpace:"nowrap",
          }}>{t.label}</button>
        ))}
      </div>

      {tab==="ecg" && (
        <div>
          <Card style={{marginBottom:16}}>
            <div style={{fontSize:13, fontWeight:800, color:C.navy, marginBottom:14}}>{editingE ? "✏️ Modifier l'ECG" : "+ Nouvel ECG"}</div>
            <label style={lbl}>Titre * (ex: Douleur thoracique H 58 ans)</label>
            <input style={inp} placeholder="Titre du cas" value={eForm.title} onChange={e=>setEForm({...eForm,title:e.target.value})}/>
            <label style={lbl}>Contexte clinique</label>
            <textarea style={{...inp, height:60, resize:"vertical"}} placeholder="SAU - patient X ans, motif..." value={eForm.context} onChange={e=>setEForm({...eForm,context:e.target.value})}/>
            <label style={lbl}>Image ECG</label>
            <label style={{display:"flex", alignItems:"center", gap:10, background:eForm.imageUrl?"#E8F7F1":"#F0F4F8", border:`2px dashed ${eForm.imageUrl?C.green:C.border}`, borderRadius:10, padding:"12px 14px", cursor:"pointer", marginBottom:10}}>
              <span style={{fontSize:22}}>{"📎"}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12, fontWeight:700, color:eForm.imageUrl?C.green:C.navy}}>{eForm.imageUrl ? eForm.imageUrl : "Cliquer pour choisir une image"}</div>
                <div style={{fontSize:10, color:C.sub}}>{"Formats acceptes : .jpg, .png"}</div>
              </div>
              {eForm.imageUrl && <span style={{color:C.green, fontWeight:800, fontSize:16}}>{"✓"}</span>}
              <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
                const file = e.target.files[0];
                if(!file) return;
                const reader = new FileReader();
                reader.onload = ev => {
                  setEForm(f => ({...f, imageUrl:file.name, imageData:ev.target.result}));
                };
                reader.readAsDataURL(file);
              }}/>
            </label>
            <label style={lbl}>Question pedagogique</label>
            <input style={inp} placeholder="Quel est votre diagnostic ?" value={eForm.question} onChange={e=>setEForm({...eForm,question:e.target.value})}/>
            <label style={lbl}>Interpretation</label>
            <textarea style={{...inp, height:70, resize:"vertical"}} placeholder="Sous-decalage ST en..." value={eForm.interpretation} onChange={e=>setEForm({...eForm,interpretation:e.target.value})}/>
            <label style={lbl}>Diagnostic final</label>
            <input style={inp} placeholder="SCA inferieur avec mirror" value={eForm.diagnosis} onChange={e=>setEForm({...eForm,diagnosis:e.target.value})}/>
            <label style={lbl}>Points pedagogiques (1 par ligne)</label>
            <textarea style={{...inp, height:80, resize:"vertical"}} placeholder={"Point 1\nPoint 2\nPoint 3"} value={eForm.points} onChange={e=>setEForm({...eForm,points:e.target.value})}/>
            <MediaUploader
              label="Photos / Vidéos supplémentaires (optionnel)"
              medias={eForm.medias}
              onChange={upd => setEForm(f=>({...f, medias: typeof upd==="function"?upd(f.medias):upd}))}
              accept="image/*,video/*"
            />
                        <label style={lbl}>Tags (optionnel)</label>
            <input style={inp} placeholder="#SCA #Arythmie #Pediatrie" value={eForm.tags} onChange={e=>setEForm({...eForm,tags:e.target.value})}/>
            {editingE && <Btn onClick={()=>{ setEditingE(null); setEForm({ title:"", context:"", question:"", interpretation:"", diagnosis:"", points:"", imageUrl:"", imageData:null, medias:[], tags:"" }); }} color={C.sub} style={{width:"100%", marginBottom:6}}>Annuler la modification</Btn>}
            <Btn onClick={addEcg} color={C.red} style={{width:"100%"}}>{editingE ? "✅ Enregistrer les modifications" : "Ajouter l'ECG"}</Btn>
          </Card>
          {customEcgs.length>0 && (
            <div>
              <div style={{fontSize:12, fontWeight:700, color:C.sub, marginBottom:8}}>ECG ajoutes ({customEcgs.length})</div>
              {customEcgs.map(e=>(
                <div key={e.id} style={{background:C.white, borderRadius:10, padding:"10px 14px", marginBottom:8, border:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:13, fontWeight:700, color:C.text}}>{e.title}</div>
                    <div style={{fontSize:11, color:C.sub}}>{e.imageUrl?"Image : "+e.imageUrl:"Trace SVG"}</div>
                  </div>
                  <div style={{display:"flex", gap:6, flexShrink:0}}>
                    <button onClick={()=>{ setEditingE(e.id); setEForm({...e, points:Array.isArray(e.points)?e.points.join("\n"):e.points||"", tags:Array.isArray(e.tags)?e.tags.join(" "):e.tags||""}); window.scrollTo(0,0); }} style={{background:"#E8A82E", color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer"}}>✏️</button>
                    <button onClick={()=>deleteItem("ecgs","admin_ecgs",e.id)} style={{background:C.red, color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer"}}>Suppr.</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab==="imagerie" && (
        <div>
          <Card style={{marginBottom:16}}>
            <div style={{fontSize:13, fontWeight:800, color:C.navy, marginBottom:14}}>{editingI ? "✏️ Modifier le cas imagerie" : "+ Nouveau cas imagerie"}</div>
            <label style={lbl}>Titre *</label>
            <input style={inp} placeholder="Titre du cas" value={iForm.title} onChange={e=>setIForm({...iForm,title:e.target.value})}/>
            <label style={lbl}>{"Type d'imagerie"}</label>
            <select style={inp} value={iForm.type} onChange={e=>setIForm({...iForm,type:e.target.value})}>
              {["Scanner","Radiographie","Echographie","IRM","Autre"].map(t=><option key={t}>{t}</option>)}
            </select>
            <label style={lbl}>Photo / Image</label>
            <label style={{display:"flex", alignItems:"center", gap:10, background:iForm.imageUrl?"#E8F7F1":"#F0F4F8", border:`2px dashed ${iForm.imageUrl?C.green:C.border}`, borderRadius:10, padding:"12px 14px", cursor:"pointer", marginBottom:10}}>
              <span style={{fontSize:22}}>{"📎"}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12, fontWeight:700, color:iForm.imageUrl?C.green:C.navy}}>{iForm.imageUrl ? iForm.imageUrl : "Cliquer pour choisir une image"}</div>
                <div style={{fontSize:10, color:C.sub}}>{"JPG, PNG, GIF, MP4..."}</div>
              </div>
              {iForm.imageUrl && <span style={{color:C.green, fontWeight:800, fontSize:16}}>{"✓"}</span>}
              <input type="file" accept="image/*,video/*" style={{display:"none"}} onChange={e=>{
                const file = e.target.files[0];
                if(!file) return;
                const reader = new FileReader();
                reader.onload = ev => setIForm(f=>({...f, imageUrl:file.name, imageData:ev.target.result, isVideo:file.type.startsWith("video/")}));
                reader.readAsDataURL(file);
              }}/>
            </label>
            {iForm.imageData && iForm.isVideo && (
              <video src={iForm.imageData} controls style={{width:"100%", borderRadius:8, marginBottom:10}} />
            )}
            {iForm.imageData && !iForm.isVideo && (
              <img src={iForm.imageData} alt="preview" style={{width:"100%", borderRadius:8, marginBottom:10, maxHeight:200, objectFit:"cover"}} />
            )}
            <label style={lbl}>Contexte clinique</label>
            <textarea style={{...inp, height:60, resize:"vertical"}} placeholder="Patient X ans, presentation..." value={iForm.context} onChange={e=>setIForm({...iForm,context:e.target.value})}/>
            <label style={lbl}>Question</label>
            <input style={inp} placeholder="Quel est votre diagnostic ?" value={iForm.question} onChange={e=>setIForm({...iForm,question:e.target.value})}/>
            <label style={lbl}>Diagnostic</label>
            <textarea style={{...inp, height:70, resize:"vertical"}} placeholder="Diagnostic + commentaires..." value={iForm.diag} onChange={e=>setIForm({...iForm,diag:e.target.value})}/>
            <MediaUploader
              label="Photos / Vidéos supplémentaires (optionnel)"
              medias={iForm.medias}
              onChange={upd => setIForm(f=>({...f, medias: typeof upd==="function"?upd(f.medias):upd}))}
              accept="image/*,video/*"
            />
                        <label style={lbl}>Tags (optionnel)</label>
            <input style={inp} placeholder="#Scanner #Radio #Fracture" value={iForm.tags} onChange={e=>setIForm({...iForm,tags:e.target.value})}/>
            {editingI && <Btn onClick={()=>{ setEditingI(null); setIForm({ title:"", type:"Scanner", context:"", question:"", diag:"", imageUrl:"", imageData:null, medias:[], tags:"" }); }} color={C.sub} style={{width:"100%", marginBottom:6}}>Annuler la modification</Btn>}
            <Btn onClick={addImagerie} color="#9B59B6" style={{width:"100%"}}>{editingI ? "✅ Enregistrer les modifications" : "Ajouter le cas"}</Btn>
          </Card>
          {customImagerie.length>0 && (
            <div>
              <div style={{fontSize:12, fontWeight:700, color:C.sub, marginBottom:8}}>Cas ajoutes ({customImagerie.length})</div>
              {customImagerie.map(c=>(
                <div key={c.id} style={{background:C.white, borderRadius:10, padding:"10px 14px", marginBottom:8, border:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:13, fontWeight:700, color:C.text}}>{c.title}</div>
                    <div style={{fontSize:11, color:C.sub}}>{c.type}{c.imageUrl?" - "+c.imageUrl:""}</div>
                  </div>
                  <div style={{display:"flex", gap:6, flexShrink:0}}>
                    <button onClick={()=>{ setEditingI(c.id); setIForm({...c, tags:Array.isArray(c.tags)?c.tags.join(" "):c.tags||""}); window.scrollTo(0,0); }} style={{background:"#E8A82E", color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer"}}>✏️</button>
                    <button onClick={()=>deleteItem("imagerie","admin_imagerie",c.id)} style={{background:C.red, color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer"}}>Suppr.</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab==="retex" && (
        <div>
          {/* ── Panneau de validation des soumissions ── */}


          {/* ── Publication directe admin (déjà validée) ── */}
          <Card style={{marginBottom:16}}>
            <div style={{fontSize:13, fontWeight:800, color:C.navy, marginBottom:4}}>+ Publication directe (admin)</div>
            <div style={{fontSize:11, color:C.sub, marginBottom:14}}>Publie immédiatement sans validation</div>

            <div style={{display:"flex", gap:8, marginBottom:12}}>
              {[{v:"retex",l:"🔬 RETEX structuré"},{v:"recit",l:"📖 Récit libre"}].map(t=>(
                <button key={t.v} onClick={()=>setRForm({...rForm,type:t.v})} style={{
                  flex:1, border:`2px solid ${rForm.type===t.v?C.green:C.border}`,
                  background:rForm.type===t.v?C.greenLight:"#fff",
                  borderRadius:10, padding:"8px 6px", fontSize:11, fontWeight:700,
                  color:rForm.type===t.v?C.green:C.sub, cursor:"pointer"
                }}>{t.l}</button>
              ))}
            </div>

            <label style={lbl}>Titre *</label>
            <input style={inp} placeholder="Ex: Arrêt cardiaque en montagne" value={rForm.title} onChange={e=>setRForm({...rForm,title:e.target.value})}/>

            <div style={{display:"flex", gap:8}}>
              <div style={{flex:1}}>
                <label style={lbl}>Auteur</label>
                <input style={inp} placeholder="Dr. Dupont" value={rForm.author} onChange={e=>setRForm({...rForm,author:e.target.value})}/>
              </div>
              <div style={{flex:1}}>
                <label style={lbl}>Date</label>
                <input style={inp} placeholder="12/05/2026" value={rForm.date} onChange={e=>setRForm({...rForm,date:e.target.value})}/>
              </div>
            </div>

            <label style={lbl}>Lieu / Service</label>
            <input style={inp} placeholder="SMUR Aubagne" value={rForm.lieu} onChange={e=>setRForm({...rForm,lieu:e.target.value})}/>

            {rForm.type==="recit" && (
              <div>
                <label style={lbl}>Récit de l'intervention</label>
                <textarea style={{...inp, height:140, resize:"vertical"}} placeholder="Racontez l'intervention librement..." value={rForm.recit} onChange={e=>setRForm({...rForm,recit:e.target.value})}/>
                <label style={lbl}>Take home message</label>
                <textarea style={{...inp, height:70, resize:"vertical"}} placeholder="Le message clé à retenir..." value={rForm.takehome} onChange={e=>setRForm({...rForm,takehome:e.target.value})}/>
              </div>
            )}

            {rForm.type==="retex" && (
              <div>
                <label style={lbl}>📍 Contexte</label>
                <textarea style={{...inp, height:60, resize:"vertical"}} placeholder="Contexte de l'intervention..." value={rForm.contexte} onChange={e=>setRForm({...rForm,contexte:e.target.value})}/>
                <label style={lbl}>🩺 Situation clinique</label>
                <textarea style={{...inp, height:80, resize:"vertical"}} placeholder="Description de la situation clinique..." value={rForm.situation} onChange={e=>setRForm({...rForm,situation:e.target.value})}/>
                <label style={lbl}>✅ Ce qui a bien fonctionné</label>
                <textarea style={{...inp, height:60, resize:"vertical"}} placeholder="Points positifs..." value={rForm.bien} onChange={e=>setRForm({...rForm,bien:e.target.value})}/>
                <label style={lbl}>⚠️ Difficultés rencontrées</label>
                <textarea style={{...inp, height:60, resize:"vertical"}} placeholder="Difficultés, imprévus..." value={rForm.difficultes} onChange={e=>setRForm({...rForm,difficultes:e.target.value})}/>
                <label style={lbl}>💡 Ce que l'on ferait différemment</label>
                <textarea style={{...inp, height:60, resize:"vertical"}} placeholder="Axes d'amélioration..." value={rForm.amelio} onChange={e=>setRForm({...rForm,amelio:e.target.value})}/>
                <label style={lbl}>🎯 Take home message</label>
                <textarea style={{...inp, height:60, resize:"vertical"}} placeholder="Le message clé à retenir..." value={rForm.takehome} onChange={e=>setRForm({...rForm,takehome:e.target.value})}/>
              </div>
            )}

            <label style={lbl}>Tags (optionnel)</label>
            <input style={inp} placeholder="#SMUR #Arret #Pediatrie" value={rForm.tags} onChange={e=>setRForm({...rForm,tags:e.target.value})}/>
            <MediaUploader
              label="📎 Photos / Vidéos / PDF du cas (optionnel)"
              medias={rForm.medias}
              onChange={upd => setRForm(f=>({...f, medias: typeof upd==="function"?upd(f.medias):upd}))}
              accept="image/*,video/*,application/pdf"
            />
            <Btn onClick={addRetex} color={C.green} style={{width:"100%"}}>✅ Publier directement</Btn>
          </Card>

          {customRetex.length>0 && (
            <div>
              <div style={{fontSize:12, fontWeight:700, color:C.sub, marginBottom:8}}>Publiés via admin ({customRetex.length})</div>
              {customRetex.map(r=>(
                <div key={r.id} style={{background:C.white, borderRadius:10, padding:"10px 14px", marginBottom:8, border:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:13, fontWeight:700, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{r.title}</div>
                    <div style={{fontSize:11, color:C.sub}}>{r.type==="recit"?"📖 Récit":"🔬 RETEX"} · {r.date}</div>
                  </div>
                  <button onClick={async()=>{ await removeRetexItem(r.id); }}
                    style={{background:C.red, color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer", flexShrink:0, marginLeft:8}}>Suppr.</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab==="agenda" && (
        <div>
          <Card style={{marginBottom:16}}>
            <div style={{fontSize:13, fontWeight:800, color:C.navy, marginBottom:14}}>{editingA ? "✏️ Modifier l'événement" : "+ Nouvel evenement"}</div>
            <label style={lbl}>Titre *</label>
            <input style={inp} placeholder="Ex: Reunion de service" value={aForm.title} onChange={e=>setAForm({...aForm,title:e.target.value})}/>
            <label style={lbl}>Type</label>
            <select style={inp} value={aForm.type} onChange={e=>setAForm({...aForm,type:e.target.value})}>
              {[{v:"formation",l:"Formation"},{v:"reunion",l:"Reunion"},{v:"congres",l:"Congres"},{v:"soiree",l:"Soiree"},{v:"autre",l:"Autre"}].map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
            <label style={lbl}>Date * <span style={{fontSize:10, color:C.sub, fontWeight:400}}>(sélecteur uniquement)</span></label>
            <input
              type="date"
              style={{...inp, cursor:"pointer", colorScheme:"light",
                background: aForm.date ? "#E8F7F1" : inp.background,
                border: aForm.date ? `1px solid ${C.green}` : inp.border,
                color: aForm.date ? C.text : C.sub,
              }}
              value={aForm.date}
              onChange={e=>setAForm({...aForm, date:e.target.value})}
              onKeyDown={e=>{ e.preventDefault(); }}
              onPaste={e=>e.preventDefault()}
              onInput={e=>{ if(!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) e.target.value=aForm.date||""; }}
              readOnly={false}
              placeholder="JJ/MM/AAAA"
              required
            />
            {aForm.date && (() => {
              const [y,m,d] = aForm.date.split("-");
              return <div style={{fontSize:11, color:C.green, fontWeight:700, marginTop:-8, marginBottom:8}}>📆 {d}/{m}/{y}</div>;
            })()}
            <label style={lbl}>Heure</label>
            <input style={inp} placeholder="14h00 - 16h00" value={aForm.heure} onChange={e=>setAForm({...aForm,heure:e.target.value})}/>
            <label style={lbl}>Lieu</label>
            <input style={inp} placeholder="Salle reunion SAU" value={aForm.lieu} onChange={e=>setAForm({...aForm,lieu:e.target.value})}/>
            <label style={lbl}>Description / Notes</label>
            <textarea style={{...inp, height:70, resize:"vertical"}} placeholder="Informations complementaires..." value={aForm.description} onChange={e=>setAForm({...aForm,description:e.target.value})}/>
            <label style={lbl}>Document ou affiche (optionnel)</label>
            <label style={{display:"flex", alignItems:"center", gap:10, background:aForm.imageUrl?"#E8F7F1":"#F0F4F8", border:`2px dashed ${aForm.imageUrl?C.green:C.border}`, borderRadius:10, padding:"12px 14px", cursor:"pointer", marginBottom:10}}>
              <span style={{fontSize:22}}>{"📎"}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12, fontWeight:700, color:aForm.imageUrl?C.green:C.navy}}>{aForm.imageUrl ? aForm.imageUrl : "Cliquer pour joindre un fichier"}</div>
                <div style={{fontSize:10, color:C.sub}}>{"PDF, image, affiche..."}</div>
              </div>
              {aForm.imageUrl && <span style={{color:C.green, fontWeight:800, fontSize:16}}>{"✓"}</span>}
              <input type="file" accept="image/*,application/pdf" style={{display:"none"}} onChange={e=>{
                const file = e.target.files[0];
                if(!file) return;
                const reader = new FileReader();
                reader.onload = ev => setAForm(f=>({...f, imageUrl:file.name, imageData:ev.target.result}));
                reader.readAsDataURL(file);
              }}/>
            </label>
            <MediaUploader
              label="Photos / Affiches supplémentaires (optionnel)"
              medias={aForm.medias}
              onChange={upd => setAForm(f=>({...f, medias: typeof upd==="function"?upd(f.medias):upd}))}
              accept="image/*,application/pdf,video/*"
            />
                        <label style={lbl}>Tags (optionnel)</label>
            <input style={inp} placeholder="#Formation #DPC #Congres" value={aForm.tags} onChange={e=>setAForm({...aForm,tags:e.target.value})}/>
            {editingA && <Btn onClick={()=>{ setEditingA(null); setAForm({ title:"", type:"formation", date:"", heure:"", lieu:"", description:"", imageUrl:"", imageData:null, medias:[], tags:"" }); }} color={C.sub} style={{width:"100%", marginBottom:6}}>Annuler la modification</Btn>}
            <Btn onClick={addAgenda} color={C.amber} style={{width:"100%"}}>{editingA ? "✅ Enregistrer les modifications" : "Ajouter l'evenement"}</Btn>
          </Card>
          {customAgenda.length>0 && (
            <div>
              <div style={{fontSize:12, fontWeight:700, color:C.sub, marginBottom:8}}>Ajoutes ({customAgenda.length})</div>
              {customAgenda.map(ev=>(
                <div key={ev.id} style={{background:C.white, borderRadius:10, padding:"10px 14px", marginBottom:8, border:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:13, fontWeight:700, color:C.text}}>{ev.title}</div>
                    <div style={{fontSize:11, color:C.sub}}>{(()=>{ const iso=ev.date&&ev.date.match(/^(\d{4})-(\d{2})-(\d{2})$/); return iso?`${iso[3]}/${iso[2]}/${iso[1]}`:ev.date; })()}</div>
                  </div>
                  <div style={{display:"flex", gap:6, flexShrink:0}}>
                    <button onClick={()=>{ setEditingA(ev.id); setAForm({...ev, tags:Array.isArray(ev.tags)?ev.tags.join(" "):ev.tags||""}); window.scrollTo(0,0); }} style={{background:"#E8A82E", color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer"}}>✏️</button>
                    <button onClick={()=>deleteItem("agenda","admin_agenda",ev.id)} style={{background:C.red, color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer"}}>Suppr.</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab==="divers" && (
        <div>
          <Card style={{marginBottom:16}}>
            <div style={{fontSize:13, fontWeight:800, color:C.navy, marginBottom:14}}>{editingD ? "✏️ Modifier la fiche" : "+ Nouvelle fiche"}</div>
            <label style={lbl}>Titre *</label>
            <input style={inp} placeholder="Ex: Dilution Ketamine" value={dForm.title} onChange={e=>setDForm({...dForm,title:e.target.value})}/>
            <label style={lbl}>{"Tags (separes par virgule ou espace)"}</label>
            <input style={inp} placeholder="ketamine, dilution, SMUR" value={dForm.tags} onChange={e=>setDForm({...dForm,tags:e.target.value})}/>
            <label style={lbl}>Contenu</label>
            <textarea style={{...inp, height:120, resize:"vertical"}} placeholder={"Ampoule : 500mg/10mL\nDose : 1-2mg/kg IV..."} value={dForm.content} onChange={e=>setDForm({...dForm,content:e.target.value})}/>
            <label style={lbl}>Image ou document (optionnel)</label>
            <label style={{display:"flex", alignItems:"center", gap:10, background:dForm.imageUrl?"#E8F7F1":"#F0F4F8", border:`2px dashed ${dForm.imageUrl?C.green:C.border}`, borderRadius:10, padding:"12px 14px", cursor:"pointer", marginBottom:10}}>
              <span style={{fontSize:22}}>{"📎"}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12, fontWeight:700, color:dForm.imageUrl?C.green:C.navy}}>{dForm.imageUrl ? dForm.imageUrl : "Cliquer pour joindre un fichier"}</div>
                <div style={{fontSize:10, color:C.sub}}>{"PDF, image..."}</div>
              </div>
              {dForm.imageUrl && <span style={{color:C.green, fontWeight:800, fontSize:16}}>{"✓"}</span>}
              <input type="file" accept="image/*,application/pdf" style={{display:"none"}} onChange={e=>{
                const file = e.target.files[0];
                if(!file) return;
                const reader = new FileReader();
                reader.onload = ev => setDForm(f=>({...f, imageUrl:file.name, imageData:ev.target.result}));
                reader.readAsDataURL(file);
              }}/>
            </label>
            {dForm.imageData && !dForm.imageUrl.endsWith(".pdf") && (
              <img src={dForm.imageData} alt="preview" style={{width:"100%", borderRadius:8, marginBottom:10, maxHeight:200, objectFit:"cover"}} />
            )}
            <MediaUploader
              label="Photos / Documents supplémentaires (optionnel)"
              medias={dForm.medias}
              onChange={upd => setDForm(f=>({...f, medias: typeof upd==="function"?upd(f.medias):upd}))}
              accept="image/*,application/pdf,video/*"
            />
            <label style={lbl}>{"Crédit photo / document (optionnel)"}</label>
            <input style={inp} placeholder="Ex: © Dr Martin, CHU Timone — CC BY-NC" value={dForm.credit||""} onChange={e=>setDForm({...dForm,credit:e.target.value})}/>

            {editingD && <Btn onClick={()=>{ setEditingD(null); setDForm({ title:"", tags:"", content:"", imageUrl:"", imageData:null, credit:"", medias:[] }); }} color={C.sub} style={{width:"100%", marginBottom:6}}>Annuler la modification</Btn>}
            <Btn onClick={addDivers} color={C.navy} style={{width:"100%"}}>{editingD ? "✅ Enregistrer les modifications" : "Ajouter la fiche"}</Btn>
          </Card>
          {customDivers.length>0 && (
            <div>
              <div style={{fontSize:12, fontWeight:700, color:C.sub, marginBottom:8}}>Ajoutes ({customDivers.length})</div>
              {customDivers.map(d=>(
                <div key={d.id} style={{background:C.white, borderRadius:10, padding:"10px 14px", marginBottom:8, border:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:13, fontWeight:700, color:C.text}}>{d.title}</div>
                    <div style={{fontSize:11, color:C.sub}}>{Array.isArray(d.tags)?d.tags.join(" "):d.tags}</div>
                  </div>
                  <div style={{display:"flex", gap:6, flexShrink:0}}>
                    <button onClick={()=>{ setEditingD(d.id); setDForm({...d, tags:Array.isArray(d.tags)?d.tags.join(" "):d.tags||""}); window.scrollTo(0,0); }} style={{background:"#E8A82E", color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer"}}>✏️</button>
                    <button onClick={()=>deleteItem("divers","admin_divers",d.id)} style={{background:C.red, color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer"}}>Suppr.</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      {tab==="dilutions" && (
        <div>
          <Card style={{marginBottom:16}}>
            <div style={{fontSize:13, fontWeight:800, color:C.navy, marginBottom:14}}>{"💉"} {editingDil ? "✏️ Modifier la dilution" : "Nouvelle dilution"}</div>

            {/* Nom DCI + couleur */}
            <div style={{display:"flex", gap:8}}>
              <div style={{flex:2}}>
                <label style={lbl}>Nom DCI (générique) *</label>
                <input style={inp} placeholder="Ex: Kétamine, Noradrénaline..." value={dilForm.title} onChange={e=>setDilForm({...dilForm,title:e.target.value})}/>
              </div>
              <div style={{flex:1}}>
                <label style={lbl}>Couleur</label>
                <input type="color" value={dilForm.color} onChange={e=>setDilForm({...dilForm,color:e.target.value})}
                  style={{...inp, padding:4, height:40, cursor:"pointer"}}/>
              </div>
            </div>

            <label style={lbl}>Nom commercial (spécialité)</label>
            <input style={inp} placeholder="Ex: Kétalar®, Levophed®..." value={dilForm.nomCommercial||""} onChange={e=>setDilForm({...dilForm,nomCommercial:e.target.value})}/>

            <label style={lbl}>Sous-titre (optionnel)</label>
            <input style={inp} placeholder="Ex: Dilution standard, Baby-Nora..." value={dilForm.subtitle} onChange={e=>setDilForm({...dilForm,subtitle:e.target.value})}/>

            <label style={lbl}>{"Tags (séparés par espace ou virgule)"}</label>
            <input style={inp} placeholder="ketamine choc analgesie" value={dilForm.tags} onChange={e=>setDilForm({...dilForm,tags:e.target.value})}/>

            {/* Schéma visuel PNG/SVG */}
            <label style={lbl}>{"📊 Schéma visuel (PNG, SVG, JPG)"}</label>
            <label style={{
              display:"flex", alignItems:"center", gap:10,
              background: dilForm.schemaUrl ? "#E8F7F1" : "#F0F4F8",
              border: `2px dashed ${dilForm.schemaUrl ? C.green : C.border}`,
              borderRadius:10, padding:"12px 14px", cursor:"pointer", marginBottom:8
            }}>
              <span style={{fontSize:22}}>{"🖼️"}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12, fontWeight:700, color: dilForm.schemaUrl ? C.green : C.navy}}>
                  {dilForm.schemaUrl ? dilForm.schemaUrl : "Cliquer pour joindre un schéma (PNG, SVG...)"}
                </div>
                <div style={{fontSize:10, color:C.sub}}>PNG, SVG, JPG recommandé pour un rendu optimal</div>
              </div>
              {dilForm.schemaUrl && <span style={{color:C.green, fontWeight:800, fontSize:16}}>{"✓"}</span>}
              <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/jpg,image/gif" style={{display:"none"}} onChange={e=>{
                const file = e.target.files[0];
                if(!file) return;
                const reader = new FileReader();
                reader.onload = ev => setDilForm(f=>({...f, schemaUrl:file.name, schemaData:ev.target.result}));
                reader.readAsDataURL(file);
              }}/>
            </label>
            {dilForm.schemaData && (
              <img src={dilForm.schemaData} alt="schema" style={{width:"100%", borderRadius:8, marginBottom:10, maxHeight:200, objectFit:"contain", background:"#0A1628"}}/>
            )}

            <label style={lbl}>{"💊 Présentation (ampoule, concentration...)"}</label>
            <textarea style={{...inp, height:60, resize:"vertical"}} placeholder={"Ampoule : 500 mg / 10 mL\nConcentration : 50 mg/mL"} value={dilForm.presentation} onChange={e=>setDilForm({...dilForm,presentation:e.target.value})}/>

            <label style={lbl}>{"🎯 Indications"}</label>
            <textarea style={{...inp, height:70, resize:"vertical"}} placeholder={"Sédation procédurale\nAnalgésie en urgence\n..."} value={dilForm.indication||""} onChange={e=>setDilForm({...dilForm,indication:e.target.value})}/>

            <label style={lbl}>{"🧪 Dilution standard (étapes détaillées)"}</label>
            <textarea style={{...inp, height:100, resize:"vertical"}} placeholder={"Prendre X mL...\nAjouter dans 40 mL NaCl 0.9%\nConcentration finale : ..."} value={dilForm.dilutionStandard} onChange={e=>setDilForm({...dilForm,dilutionStandard:e.target.value})}/>

            <label style={lbl}>{"🩺 Administration (voie, débit, titration...)"}</label>
            <textarea style={{...inp, height:90, resize:"vertical"}} placeholder={"Voie veineuse centrale\nDébit de départ : 0.1 mcg/kg/min\nTitrer par paliers de 0.05...\nNe pas injecter en périphérique..."} value={dilForm.administration||""} onChange={e=>setDilForm({...dilForm,administration:e.target.value})}/>

            {/* Photo complémentaire */}
            <label style={lbl}>{"📷 Photo complémentaire (optionnel)"}</label>
            <label style={{
              display:"flex", alignItems:"center", gap:10,
              background: dilForm.photoUrl ? "#E8F7F1" : "#F0F4F8",
              border: `2px dashed ${dilForm.photoUrl ? C.green : C.border}`,
              borderRadius:10, padding:"12px 14px", cursor:"pointer", marginBottom:8
            }}>
              <span style={{fontSize:22}}>{"📷"}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12, fontWeight:700, color: dilForm.photoUrl ? C.green : C.navy}}>
                  {dilForm.photoUrl ? dilForm.photoUrl : "Cliquer pour joindre une photo"}
                </div>
                <div style={{fontSize:10, color:C.sub}}>PNG, JPG — photo du médicament, du montage...</div>
              </div>
              {dilForm.photoUrl && <span style={{color:C.green, fontWeight:800, fontSize:16}}>{"✓"}</span>}
              <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
                const file = e.target.files[0];
                if(!file) return;
                const reader = new FileReader();
                reader.onload = ev => setDilForm(f=>({...f, photoUrl:file.name, photoData:ev.target.result}));
                reader.readAsDataURL(file);
              }}/>
            </label>
            {dilForm.photoData && (
              <img src={dilForm.photoData} alt="photo" style={{width:"100%", borderRadius:8, marginBottom:10, maxHeight:180, objectFit:"contain"}}/>
            )}

            <MediaUploader
              label="Médias supplémentaires (optionnel)"
              medias={dilForm.medias}
              onChange={upd => setDilForm(f=>({...f, medias: typeof upd==="function"?upd(f.medias):upd}))}
              accept="image/*,video/*,application/pdf"
            />

            {editingDil && <Btn onClick={()=>{ setEditingDil(null); setDilForm({ title:"", nomCommercial:"", subtitle:"", color:"#E05260", tags:"", presentation:"", indication:"", dilutionStandard:"", administration:"", schemaUrl:"", schemaData:null, photoUrl:"", photoData:null, medias:[] }); }} color={C.sub} style={{width:"100%", marginBottom:6}}>Annuler la modification</Btn>}
            <Btn onClick={addDilution} color={C.red} style={{width:"100%"}}>{editingDil ? "✅ Enregistrer les modifications" : "Ajouter la dilution"}</Btn>
          </Card>

          {customDilutions.length>0 && (
            <div>
              <div style={{fontSize:12, fontWeight:700, color:C.sub, marginBottom:8}}>Ajoutees ({customDilutions.length})</div>
              {customDilutions.map(d=>(
                <div key={d.id} style={{background:C.white, borderRadius:10, padding:"10px 14px", marginBottom:8, border:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", borderLeft:`4px solid ${d.color||C.red}`}}>
                  <div>
                    <div style={{fontSize:13, fontWeight:700, color:C.text}}>{d.title}</div>
                    <div style={{fontSize:11, color:C.sub}}>{d.subtitle||""} {Array.isArray(d.tags)?d.tags.join(" "):""}</div>
                  </div>
                  <div style={{display:"flex", gap:6}}>
                    <button onClick={()=>{ setEditingDil(d.id); setDilForm({...d, tags:Array.isArray(d.tags)?d.tags.join(" "):d.tags||"", nomCommercial:d.nomCommercial||"", indication:d.indication||"", administration:d.administration||"", photoUrl:d.photoUrl||"", photoData:null}); window.scrollTo(0,0); }} style={{background:"#E8A82E", color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer"}}>✏️</button>
                    <button onClick={()=>deleteItem("dilutions","admin_dilutions",d.id)} style={{background:C.red, color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer"}}>Suppr.</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      {tab==="gestes" && (
        <div>
          <Card style={{marginBottom:16}}>
            <div style={{fontSize:13, fontWeight:800, color:C.navy, marginBottom:14}}>{"✂️"} {editingG ? "✏️ Modifier le geste" : "Nouveau geste"}</div>

            <label style={lbl}>Titre *</label>
            <input style={inp} placeholder="Ex: Cricothyrotomie" value={gForm.title} onChange={e=>setGForm({...gForm,title:e.target.value})}/>

            <label style={lbl}>{"Icone"}</label>
            <div style={{display:"flex", gap:6, marginBottom:10, flexWrap:"wrap"}}>
              {["✂️","🫁","🦴","🫀","💉","🧠","🩺","🔬","⚡","🩹"].map(ic=>(
                <button key={ic} onClick={()=>setGForm({...gForm,icon:ic})} style={{
                  background: gForm.icon===ic ? C.blue : C.blueLight,
                  border:`1px solid ${gForm.icon===ic ? C.blue : C.border}`,
                  borderRadius:8, padding:"6px 10px", cursor:"pointer", fontSize:16}}>
                  {ic}
                </button>
              ))}
            </div>

            <label style={lbl}>Couleur</label>
            <div style={{display:"flex", gap:8, marginBottom:10}}>
              {["#C0392B","#E67E22","#8E44AD","#2E9E6B","#2E7EAD","#E8A82E"].map(c=>(
                <button key={c} onClick={()=>setGForm({...gForm,color:c})} style={{
                  width:28, height:28, borderRadius:"50%", background:c,
                  border: gForm.color===c ? `3px solid ${C.navy}` : `2px solid ${C.border}`,
                  cursor:"pointer"}}/>
              ))}
            </div>

            <label style={lbl}>Tags (separes par virgule)</label>
            <input style={inp} placeholder="airway, IOT, urgence" value={gForm.tags} onChange={e=>setGForm({...gForm,tags:e.target.value})}/>

            <label style={lbl}>Indications</label>
            <textarea style={{...inp, height:70, resize:"vertical"}} value={gForm.indications} onChange={e=>setGForm({...gForm,indications:e.target.value})} placeholder="Indications cliniques..."/>

            <label style={lbl}>{"Materiel (1 item par ligne)"}</label>
            <textarea style={{...inp, height:80, resize:"vertical"}} value={gForm.materiel} onChange={e=>setGForm({...gForm,materiel:e.target.value})} placeholder={"Seringue 10 mL\nLaryngoscope..."}/>

            <label style={lbl}>{"Etapes (1 etape par ligne)"}</label>
            <textarea style={{...inp, height:100, resize:"vertical"}} value={gForm.etapes} onChange={e=>setGForm({...gForm,etapes:e.target.value})} placeholder={"Installer le patient\nPreoxygener 3 min..."}/>

            <label style={lbl}>{"Pieges / Points critiques (1 par ligne)"}</label>
            <textarea style={{...inp, height:70, resize:"vertical"}} value={gForm.pieges} onChange={e=>setGForm({...gForm,pieges:e.target.value})} placeholder={"Verifier position\nNe pas depasser 30 sec..."}/>

            <label style={lbl}>Complications (1 par ligne)</label>
            <textarea style={{...inp, height:60, resize:"vertical"}} value={gForm.complications} onChange={e=>setGForm({...gForm,complications:e.target.value})} placeholder={"Intubation oesophagienne\nPneumothorax..."}/>

            <label style={lbl}>{"Lien video YouTube (optionnel)"}</label>
            <input style={inp} placeholder="https://youtube.com/watch?v=..." value={gForm.videoUrl} onChange={e=>setGForm({...gForm,videoUrl:e.target.value})}/>

            <label style={lbl}>{"Crédit photo / vidéo (optionnel)"}</label>
            <input style={inp} placeholder="Ex: © Dr Martin, CHU Timone — CC BY-NC" value={gForm.credit} onChange={e=>setGForm({...gForm,credit:e.target.value})}/>

            <MediaUploader
              label="Photos / Vidéos du geste (optionnel)"
              medias={gForm.medias}
              onChange={upd => setGForm(f=>({...f, medias: typeof upd==="function"?upd(f.medias):upd}))}
              accept="image/*,video/*"
            />

            {editingG && <Btn onClick={()=>{ setEditingG(null); setGForm({ title:"", icon:"✂️", color:"#C0392B", tags:"", indications:"", materiel:"", etapes:"", pieges:"", complications:"", videoUrl:"", credit:"", medias:[] }); }} color={C.sub} style={{width:"100%", marginBottom:6}}>Annuler la modification</Btn>}
            <Btn onClick={addGeste} color={C.red} style={{width:"100%"}}>{editingG ? "✅ Enregistrer les modifications" : "✂️ Ajouter le geste"}</Btn>
          </Card>

          {customGestes.length>0 && (
            <div>
              <div style={{fontSize:12, fontWeight:700, color:C.sub, marginBottom:8}}>Gestes ajoutes ({customGestes.length})</div>
              {customGestes.map(g=>(
                <div key={g.id} style={{background:C.white, borderRadius:10, padding:"10px 14px", marginBottom:8,
                  border:`1px solid ${C.border}`, borderLeft:`4px solid ${g.color||C.red}`,
                  display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:13, fontWeight:700, color:C.text}}>{g.icon} {g.title}</div>
                    <div style={{fontSize:11, color:C.sub}}>{(g.tags||[]).join(" ")}</div>
                  </div>
                  <div style={{display:"flex", gap:6}}>
                    <button onClick={()=>{ setEditingG(g.id); setGForm({...g, tags:Array.isArray(g.tags)?g.tags.join(" "):g.tags||"", materiel:Array.isArray(g.materiel)?g.materiel.join("\n"):g.materiel||"", etapes:Array.isArray(g.etapes)?g.etapes.join("\n"):g.etapes||"", pieges:Array.isArray(g.pieges)?g.pieges.join("\n"):g.pieges||"", complications:Array.isArray(g.complications)?g.complications.join("\n"):g.complications||""}); window.scrollTo(0,0); }} style={{background:"#E8A82E", color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer"}}>✏️</button>
                    <button onClick={()=>deleteItem("gestes","admin_gestes",g.id)}
                      style={{background:C.red, color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer"}}>
                      Suppr.
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab==="annuaire" && (
        <div>
          {/* Formulaire ajout / modification contact */}
          <div style={{background:C.white, border:`1px solid ${editingC!==null ? C.blue : C.border}`, borderRadius:14, padding:16, marginBottom:18}}>
            <div style={{fontSize:13, fontWeight:800, color:C.navy, marginBottom:14}}>
              {editingC!==null ? "✏️ Modifier le contact" : "➕ Ajouter un contact"}
            </div>

            <div style={{marginBottom:10}}>
              <div style={{fontSize:11, fontWeight:700, color:C.sub, marginBottom:4}}>NOM *</div>
              <input value={cForm.nom} onChange={e=>setCForm(f=>({...f,nom:e.target.value}))}
                placeholder="Ex: Dr Dupont, SAMU 13, Réanimation Timone..."
                style={{width:"100%", border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 12px", fontSize:13, color:C.text, background:C.bg, fontFamily:"inherit", boxSizing:"border-box"}}/>
            </div>

            <div style={{marginBottom:10}}>
              <div style={{fontSize:11, fontWeight:700, color:C.sub, marginBottom:4}}>CATÉGORIE (optionnel)</div>
              <input value={cForm.categorie} onChange={e=>setCForm(f=>({...f,categorie:e.target.value}))}
                placeholder="Ex: Cardiologie, SAMU, Chirurgie..."
                style={{width:"100%", border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 12px", fontSize:13, color:C.text, background:C.bg, fontFamily:"inherit", boxSizing:"border-box"}}/>
            </div>

            <div style={{marginBottom:14}}>
              <div style={{fontSize:11, fontWeight:700, color:C.sub, marginBottom:4}}>RÔLE / DESCRIPTION (optionnel)</div>
              <input value={cForm.role} onChange={e=>setCForm(f=>({...f,role:e.target.value}))}
                placeholder="Ex: Urgences H24, Senior de garde..."
                style={{width:"100%", border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 12px", fontSize:13, color:C.text, background:C.bg, fontFamily:"inherit", boxSizing:"border-box"}}/>
            </div>

            {/* Téléphones */}
            <div style={{fontSize:11, fontWeight:700, color:C.sub, marginBottom:8}}>TÉLÉPHONE(S) *</div>
            {cForm.telephones.map((t,i)=>(
              <div key={i} style={{display:"flex", gap:8, marginBottom:8, alignItems:"center"}}>
                <input value={t.label} onChange={e=>setCForm(f=>({...f, telephones:f.telephones.map((x,j)=>j===i?{...x,label:e.target.value}:x)}))}
                  placeholder="Libellé (ex: Standard, Mobile)"
                  style={{width:130, border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 10px", fontSize:12, color:C.text, background:C.bg, fontFamily:"inherit", flexShrink:0}}/>
                <input value={t.numero} onChange={e=>setCForm(f=>({...f, telephones:f.telephones.map((x,j)=>j===i?{...x,numero:e.target.value}:x)}))}
                  placeholder="04 XX XX XX XX"
                  style={{flex:1, border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 10px", fontSize:13, color:C.text, background:C.bg, fontFamily:"inherit"}}/>
                {cForm.telephones.length>1 && (
                  <button onClick={()=>setCForm(f=>({...f, telephones:f.telephones.filter((_,j)=>j!==i)}))}
                    style={{background:C.redLight, border:"none", borderRadius:8, padding:"9px 10px", color:C.red, fontSize:14, cursor:"pointer", flexShrink:0}}>✕</button>
                )}
              </div>
            ))}
            <button onClick={()=>setCForm(f=>({...f, telephones:[...f.telephones,{label:"",numero:""}]}))}
              style={{background:C.blueLight, border:"none", borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:700, color:C.blue, cursor:"pointer", marginBottom:14}}>
              + Ajouter un numéro
            </button>

            <div style={{display:"flex", gap:8}}>
              {editingC!==null && (
                <button onClick={()=>{ setEditingC(null); setCForm({ nom:"", categorie:"", role:"", telephones:[{label:"",numero:""}] }); }}
                  style={{flex:1, background:C.border, color:C.text, border:"none", borderRadius:10, padding:"11px 0", fontSize:13, fontWeight:700, cursor:"pointer"}}>
                  Annuler
                </button>
              )}
              <button onClick={async()=>{
                if(!cForm.nom.trim()) return;
                const tels = cForm.telephones.filter(t=>t.numero.trim());
                if(editingC!==null) {
                  const updated = { id:editingC, nom:cForm.nom.trim(), categorie:cForm.categorie.trim(), role:cForm.role.trim(), telephones:tels };
                  await updateItem("contacts","admin_contacts",updated,[]);
                  setEditingC(null);
                  showSaved("Contact modifié !");
                } else {
                  const newContact = { id:Date.now(), nom:cForm.nom.trim(), categorie:cForm.categorie.trim(), role:cForm.role.trim(), telephones:tels };
                  await addItem("contacts","admin_contacts",newContact,[]);
                  showSaved("Contact ajouté !");
                }
                setCForm({ nom:"", categorie:"", role:"", telephones:[{label:"",numero:""}] });
              }} style={{flex:1, background:editingC!==null ? C.blue : C.navy, color:"#fff", border:"none", borderRadius:10, padding:"11px 0", fontSize:14, fontWeight:800, cursor:"pointer"}}>
                {editingC!==null ? "✏️ Enregistrer les modifications" : "💾 Enregistrer le contact"}
              </button>
            </div>
          </div>

          {/* Liste des contacts enregistrés */}
          <div style={{fontSize:13, fontWeight:700, color:C.navy, marginBottom:10}}>
            Contacts enregistrés ({customContacts.length})
          </div>
          {customContacts.length===0 ? (
            <div style={{textAlign:"center", padding:"24px 20px", color:C.sub, background:C.white, borderRadius:12, border:`1px solid ${C.border}`}}>
              <div style={{fontSize:32, marginBottom:8}}>{"📒"}</div>
              <div style={{fontSize:13}}>Aucun contact ajouté</div>
            </div>
          ) : (
            [...customContacts].reverse().map(p=>(
              <div key={p.id} style={{background:editingC===p.id ? C.blueLight : C.white, borderRadius:10, padding:"12px 14px", marginBottom:8, border:`1.5px solid ${editingC===p.id ? C.blue : C.border}`}}>
                <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start"}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13, fontWeight:800, color:C.text}}>{p.nom}</div>
                    {p.categorie && <div style={{fontSize:11, color:C.blue, fontWeight:700, marginTop:2}}>{p.categorie}</div>}
                    {p.role && <div style={{fontSize:11, color:C.sub, marginTop:1}}>{p.role}</div>}
                    {(p.telephones||[]).map((t,i)=>(
                      <div key={i} style={{marginTop:4, display:"flex", alignItems:"center", gap:6}}>
                        {t.label && <span style={{fontSize:10, color:C.sub}}>{t.label} :</span>}
                        <a href={`tel:${t.numero}`} style={{fontSize:12, fontWeight:700, color:C.blue, textDecoration:"none"}}>📞 {t.numero}</a>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex", gap:6, flexShrink:0, marginLeft:8}}>
                    <button onClick={()=>{
                      setEditingC(p.id);
                      setCForm({ nom:p.nom, categorie:p.categorie||"", role:p.role||"", telephones:(p.telephones&&p.telephones.length)?p.telephones:[{label:"",numero:""}] });
                      window.scrollTo({top:0,behavior:"smooth"});
                    }} style={{background:C.blueLight, border:"none", borderRadius:8, padding:"6px 10px", color:C.blue, fontSize:12, cursor:"pointer"}}>
                      ✏️
                    </button>
                    <button onClick={async()=>{ await removeItem("contacts","admin_contacts",p.id); if(editingC===p.id){setEditingC(null);setCForm({nom:"",categorie:"",role:"",telephones:[{label:"",numero:""}]});} showSaved("Contact supprimé"); }}
                      style={{background:C.redLight, border:"none", borderRadius:8, padding:"6px 10px", color:C.red, fontSize:12, cursor:"pointer"}}>
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <div style={{marginTop:20, padding:"12px 16px", background:C.amberLight, border:`1px solid ${C.amber}`, borderRadius:12, fontSize:11, color:C.text, lineHeight:1.6}}>
        <div style={{fontWeight:800, color:C.amber, marginBottom:4}}>{"📎 Comment ajouter un fichier ?"}</div>
        Cliquez sur la zone pointillee pour selectionner un PDF ou une image depuis votre appareil. Le fichier est charge directement dans l'application et sauvegarde pour les prochaines sessions.
      </div>
    </div>
  );
}

// - App -
export default function App() {
  return (
    <DataProvider>
      <AppInner/>
    </DataProvider>
  );
}

function AppInner() {
  const [screen, setScreen] = useState("home");
  const [deepLink, setDeepLink] = useState(null);
  const [navVersion, setNavVersion] = useState(0);
  const [retexCount, setRetexCount] = useState(0);
  const [dark, setDark] = useState(()=> window._darkMode || false);
  const theme = dark ? DARK : LIGHT;

  function toggleDark() {
    setDark(d => {
      const next = !d;
      window._darkMode = next;
      return next;
    });
  }

  const { notifs, pushNotif, clearAll } = useNotifications();
  const [notifOpen, setNotifOpen] = useState(false);
  const unreadCount = notifs.length;

  function navigate(screenId, favoriItem) {
    setScreen(screenId);
    setDeepLink(favoriItem ? favoriItem.id : null);
    setNavVersion(v => v + 1);
    setNotifOpen(false);
  }

  useEffect(()=>{
    setRetexCount(0);
  },[]);

  const tabs = [
    {id:"home",       icon:"🏠", label:"Accueil"},
    {id:"favoris",    icon:"⭐", label:"Favoris"},
    {id:"gestes",     icon:"✂️",  label:"Gestes"},
    {id:"retex",      icon:"🔬", label:"RETEX", badge:retexCount>0, badgeCount:retexCount},
    {id:"dilutions",  icon:"💉", label:"Dilutions"},
    {id:"annuaire",   icon:"📒", label:"Contacts"},
  ];

  const contentRef = React.useRef(null);

  useEffect(()=>{
    document.body.style.margin="0";
    document.body.style.background=theme.bg;
    document.body.style.fontFamily="'Segoe UI', system-ui, sans-serif";
    if(!document.getElementById('app-global-style')) {
      const style = document.createElement('style');
      style.id = 'app-global-style';
      style.textContent = `@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(1.3)} }
    @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
    * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
    ::-webkit-scrollbar { width: 4px; height: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 4px; }
    body { transition: background .25s; }
    `;
      document.head.appendChild(style);
    }
  },[]);

  useEffect(()=>{
    if(contentRef.current) contentRef.current.scrollTop = 0;
  },[screen]);

  useEffect(()=>{
    document.body.style.background = theme.bg;
    document.body.style.transition = "background .25s";
  },[dark]);

  return (
    <ThemeCtx.Provider value={theme}>
    <div style={{maxWidth:420, margin:"0 auto", minHeight:"100vh", background:theme.bg, display:"flex", flexDirection:"column", position:"relative", transition:"background .25s"}}>
      {/* Barre du haut — tous écrans */}
      <div style={{background:theme.navy, padding:"8px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0, transition:"background .25s"}}>
        <div style={{display:"flex", alignItems:"center", gap:10}}>
          <div style={{background:"#fff", borderRadius:8, padding:"3px 6px", display:"flex", alignItems:"center", justifyContent:"center"}}>
            <img src={LOGO_HOSP} alt="CH Aubagne" style={{height:28, width:"auto", display:"block"}}/>
          </div>
          <div>
            <div style={{color:"#fff", fontSize:12, fontWeight:800, lineHeight:1.2}}>SAU / SMUR</div>
            <div style={{color:"rgba(255,255,255,.6)", fontSize:10, fontWeight:600, lineHeight:1.2}}>Aubagne</div>
          </div>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:10}}>
          {/* Toggle Nuit / Jour */}
          <button onClick={toggleDark} title={dark?"Mode jour":"Mode nuit"} style={{
            background: dark ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.15)",
            border: "1.5px solid rgba(255,255,255,.25)",
            borderRadius:20, padding:"3px 10px", cursor:"pointer",
            display:"flex", alignItems:"center", gap:5, color:"#fff",
            fontSize:13, fontWeight:700, transition:"all .2s"
          }}>
            <span style={{fontSize:15}}>{dark ? "☀️" : "🌙"}</span>
            <span style={{fontSize:10, letterSpacing:.3}}>{dark ? "Jour" : "Nuit"}</span>
          </button>

          {/* Cloche notifications */}
          <div style={{position:"relative"}}>
            <button onClick={()=>setNotifOpen(o=>!o)} style={{
              background: notifOpen ? "rgba(255,255,255,.25)" : "rgba(255,255,255,.12)",
              border: "1.5px solid rgba(255,255,255,.25)",
              borderRadius:10, width:36, height:36, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:18, transition:"all .2s"
            }}>🔔</button>
            {unreadCount>0 && (
              <div style={{position:"absolute", top:-4, right:-4,
                background:"#EF4444", color:"#fff", borderRadius:"50%",
                minWidth:18, height:18, fontSize:10, fontWeight:800,
                display:"flex", alignItems:"center", justifyContent:"center",
                border:"2px solid "+theme.navy, padding:"0 2px", lineHeight:1}}>
                {unreadCount>9?"9+":unreadCount}
              </div>
            )}
            {notifOpen && (
              <NotifPanel
                notifs={notifs}
                onNav={navigate}
                onClear={()=>{ clearAll(); setNotifOpen(false); }}
                onClose={()=>setNotifOpen(false)}
                theme={theme}
              />
            )}
          </div>
        </div>
      </div>

      <div ref={contentRef} data-content-scroll style={{flex:1, padding:"16px 16px 90px", overflowY:"auto", background:theme.bg, transition:"background .25s"}}>
        {screen==="home"       && <HomeScreen onNav={navigate}/>}
        {screen==="favoris"    && <FavorisScreen key={"favoris-"+navVersion} onNav={navigate}/>}
        {screen==="retex"      && <RetexScreen key={"retex-"+navVersion} deepLinkId={deepLink}/>}
        {screen==="ecg"        && <ECGScreen key={"ecg-"+navVersion} deepLinkId={deepLink}/>}
        {screen==="imagerie"   && <IconoScreen key={"imagerie-"+navVersion} deepLinkId={deepLink}/>}
        {screen==="agenda"     && <AgendaScreen key={"agenda-"+navVersion} deepLinkId={deepLink}/>}
        {screen==="gestes"     && <GestesScreen key={"gestes-"+navVersion} deepLinkId={deepLink}/>}
        {screen==="dilutions"  && <DilutionScreen key={"dilutions-"+navVersion} deepLinkId={deepLink}/>}
        {screen==="divers"     && <DiversScreen key={"divers-"+navVersion} deepLinkId={deepLink}/>}
        {screen==="annuaire"   && <AnnuaireScreen key={"annuaire-"+navVersion}/>}
        {screen==="admin"      && <AdminScreen onNewItem={pushNotif}/>}
      </div>

      <div style={{position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:420, background:theme.white, borderTop:`1px solid ${theme.border}`, display:"flex", padding:"8px 0 12px", boxShadow:"0 -4px 20px rgba(26,58,92,.08)", transition:"background .25s"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>{ setScreen(t.id); setNavVersion(v=>v+1); }} style={{flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"4px 0", touchAction:"manipulation", WebkitTapHighlightColor:"transparent"}}>
            <div style={{position:"relative", display:"inline-block"}}>
              <span style={{fontSize:18, filter:screen===t.id?"none":"grayscale(40%) opacity(0.7)"}}>{t.icon}</span>
              {t.badge && screen!==t.id && (
                t.badgeCount>1 ? (
                  <span style={{position:"absolute", top:-4, right:-6, background:"#EF4444", color:"#fff", borderRadius:8, minWidth:16, height:16, fontSize:9, fontWeight:900, display:"flex", alignItems:"center", justifyContent:"center", border:"1.5px solid "+theme.white, padding:"0 3px", lineHeight:1}}>
                    {t.badgeCount>9?"9+":t.badgeCount}
                  </span>
                ) : (
                  <span style={{position:"absolute", top:-2, right:-4, width:7, height:7, borderRadius:"50%", background:theme.red, border:"1.5px solid "+theme.white}}/>
                )
              )}
            </div>
            <span style={{fontSize:9, fontWeight:screen===t.id?800:600, color:screen===t.id?theme.blue:theme.sub, letterSpacing:.3}}>{t.label}</span>
            {screen===t.id && <div style={{width:20, height:2, borderRadius:2, background:theme.blue, marginTop:1}}/>}
          </button>
        ))}
      </div>
    </div>
    </ThemeCtx.Provider>
  );
}
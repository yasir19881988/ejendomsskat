import { NextRequest, NextResponse } from 'next/server';
import { dawaClient } from '@/lib/dawa';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q') ?? '';
  const limit = parseInt(searchParams.get('limit') ?? '10', 10);

  if (query.length < 3) {
    return NextResponse.json({ forslag: [] });
  }

  // Fjern postnummer fra query hvis det findes (f.eks. "Hjallesevej 5240" → "Hjallesevej")
  // DAR's startsWith filter matcher ikke når postnummer er inkluderet
  const queryUdenPostnr = query.replace(/\s+\d{4}$/, '').trim();

  try {
    const resultater = await dawaClient.autocompleteAdresse(queryUdenPostnr, limit * 2); // Hent flere for at kunne deduplikere

    // Dedupliker på forslagstekst (samme adresse kan have flere varianter)
    const unikke = new Map<string, typeof resultater[0]>();
    for (const r of resultater) {
      const key = r.forslagstekst.toLowerCase().trim();
      if (!unikke.has(key)) {
        unikke.set(key, r);
      }
    }

    // Begræns til ønsket antal
    const deduplikeret = Array.from(unikke.values()).slice(0, limit);

    return NextResponse.json({
      forslag: deduplikeret.map((r) => ({
        id: r.data.id,
        tekst: r.tekst,
        forslagstekst: r.forslagstekst,
      })),
    });
  } catch (error) {
    console.error('Autocomplete fejl:', error);
    return NextResponse.json(
      { forslag: [], fejl: 'Kunne ikke hente adresseforslag' },
      { status: 500 }
    );
  }
}

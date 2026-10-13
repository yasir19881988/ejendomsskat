import { NextRequest, NextResponse } from 'next/server';
import { dawaClient } from '@/lib/dawa';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q') ?? '';
  const limit = parseInt(searchParams.get('limit') ?? '10', 10);

  if (query.length < 3) {
    return NextResponse.json({ forslag: [] });
  }

  try {
    const resultater = await dawaClient.autocompleteAdresse(query, limit);

    return NextResponse.json({
      forslag: resultater.map((r) => ({
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

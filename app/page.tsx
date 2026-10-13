'use client';

import { useState, useEffect, useCallback } from 'react';
import { EjendomResponse } from '@/app/api/ejendom/route';

// ---------- Types ----------

interface AdresseForslag {
  id: string;
  tekst: string;
  forslagstekst: string;
}

interface SogeState {
  query: string;
  forslag: AdresseForslag[];
  visForslag: boolean;
  valgtAdresse: AdresseForslag | null;
  loader: boolean;
  fejl: string | null;
}

// ---------- Komponenter ----------

function SogeFelt({
  state,
  onQueryChange,
  onVaelg,
  onSoeg,
}: {
  state: SogeState;
  onQueryChange: (q: string) => void;
  onVaelg: (adresse: AdresseForslag) => void;
  onSoeg: () => void;
}) {
  return (
    <div className="relative w-full max-w-2xl">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={state.query}
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={() => state.forslag.length > 0 && onQueryChange(state.query)}
            placeholder="Indtast adresse (f.eks. Frederiksberg Allé 10, 2000 Frederiksberg)"
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-lg shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
          {state.visForslag && state.forslag.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {state.forslag.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onVaelg(f)}
                    className="w-full px-4 py-3 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <span className="font-medium">{f.forslagstekst}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={onSoeg}
          disabled={state.loader || !state.valgtAdresse}
          className="rounded-lg bg-blue-600 px-6 py-3 text-lg font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.loader ? 'Søger...' : 'Tjek vurdering'}
        </button>
      </div>
      {state.fejl && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{state.fejl}</p>
      )}
    </div>
  );
}

function DataKort({
  titel,
  vaerdi,
  enhed,
  beskrivelse,
  advarsel,
}: {
  titel: string;
  vaerdi: string | number | null;
  enhed?: string;
  beskrivelse?: string;
  advarsel?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-5 shadow-sm ${
        advarsel
          ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
          : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
      }`}
    >
      <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{titel}</h3>
      <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
        {vaerdi !== null && vaerdi !== undefined ? (
          <>
            {typeof vaerdi === 'number' ? vaerdi.toLocaleString('da-DK') : vaerdi}
            {enhed && <span className="ml-1 text-base font-normal text-zinc-500">{enhed}</span>}
          </>
        ) : (
          <span className="text-zinc-400">—</span>
        )}
      </p>
      {beskrivelse && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{beskrivelse}</p>
      )}
    </div>
  );
}

function IndsigelseBanner({ data }: { data: EjendomResponse['data'] }) {
  if (!data?.indsigelse.potentiale) return null;

  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-6 dark:border-amber-600 dark:bg-amber-950/40">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-400 text-2xl">
          ⚠️
        </div>
        <div>
          <h3 className="text-lg font-bold text-amber-900 dark:text-amber-200">
            Potentiale for indsigelse mod ejendomsvurderingen
          </h3>
          <p className="mt-1 text-amber-800 dark:text-amber-300">{data.indsigelse.begrundelse}</p>
          {data.indsigelse.procentOverMarked !== null && (
            <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-400">
              Vurderingen ligger {data.indsigelse.procentOverMarked}% over markedets m²-pris
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function NabotjekTabel({ data }: { data: EjendomResponse['data'] }) {
  if (!data?.nabosammenligning || data.nabosammenligning.antalReferencer === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Nabotjek</h3>
        <p className="mt-2 text-zinc-500 dark:text-zinc-400">
          Ingen referencsalg fundet i området. Prøv en anden adresse eller kontakt support.
        </p>
      </div>
    );
  }

  const n = data.nabosammenligning;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Nabotjek</h3>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Baseret på {n.antalReferencer} solgte ejendomme i samme postnummer ({n.sammenligningsPeriode})
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Gns. m²-pris</p>
          <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-white">
            {n.gennemsnitM2Pris.toLocaleString('da-DK')} kr/m²
          </p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Median m²-pris</p>
          <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-white">
            {n.medianM2Pris.toLocaleString('da-DK')} kr/m²
          </p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Antal referencer</p>
          <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-white">{n.antalReferencer}</p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700">
              <th className="pb-3 font-medium text-zinc-500 dark:text-zinc-400">Adresse</th>
              <th className="pb-3 font-medium text-zinc-500 dark:text-zinc-400">Salgspris</th>
              <th className="pb-3 font-medium text-zinc-500 dark:text-zinc-400">Areal</th>
              <th className="pb-3 font-medium text-zinc-500 dark:text-zinc-400">m²-pris</th>
              <th className="pb-3 font-medium text-zinc-500 dark:text-zinc-400">Dato</th>
            </tr>
          </thead>
          <tbody>
            {n.referencer.slice(0, 10).map((ref, i) => (
              <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-3 text-zinc-900 dark:text-white">{ref.adresse}</td>
                <td className="py-3 text-zinc-900 dark:text-white">
                  {ref.koebesum.toLocaleString('da-DK')} kr
                </td>
                <td className="py-3 text-zinc-900 dark:text-white">{ref.boligArealM2} m²</td>
                <td className="py-3 font-medium text-blue-600 dark:text-blue-400">
                  {Math.round(ref.m2Pris).toLocaleString('da-DK')} kr/m²
                </td>
                <td className="py-3 text-zinc-500 dark:text-zinc-400">{ref.salgsdato}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Hovedside ----------

export default function Home() {
  const [state, setState] = useState<SogeState>({
    query: '',
    forslag: [],
    visForslag: false,
    valgtAdresse: null,
    loader: false,
    fejl: null,
  });

  const [resultat, setResultat] = useState<EjendomResponse | null>(null);
  const [resultatLoader, setResultatLoader] = useState(false);
  const [manuelBfe, setManuelBfe] = useState('');

  // Debounce autocomplete
  useEffect(() => {
    if (state.query.length < 3) {
      setState((s) => ({ ...s, forslag: [], visForslag: false }));
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/adresse?q=${encodeURIComponent(state.query)}&limit=8`);
        if (!res.ok) throw new Error('Autocomplete fejlede');
        const data = await res.json();
        setState((s) => ({
          ...s,
          forslag: data.forslag ?? [],
          visForslag: true,
          fejl: null,
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          forslag: [],
          visForslag: false,
          fejl: 'Kunne ikke hente adresseforslag. Prøv igen.',
        }));
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [state.query]);

  const handleVaelg = useCallback((adresse: AdresseForslag) => {
    setState((s) => ({
      ...s,
      valgtAdresse: adresse,
      query: adresse.forslagstekst,
      visForslag: false,
    }));
  }, []);

  const handleSoeg = useCallback(async () => {
    if (!state.valgtAdresse) return;

    setResultatLoader(true);
    setState((s) => ({ ...s, fejl: null }));

    try {
      // Hvis ID er et rent tal, er det et BFE-nummer
      const erBfe = /^\d+$/.test(state.valgtAdresse.id);
      const body = erBfe
        ? { bfeNummer: state.valgtAdresse.id }
        : { adresseId: state.valgtAdresse.id };

      const res = await fetch('/api/ejendom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data: EjendomResponse = await res.json();

      if (!data.success) {
        setState((s) => ({ ...s, fejl: data.error ?? 'Ukendt fejl' }));
        setResultat(null);
      } else {
        setResultat(data);
      }
    } catch (err) {
      setState((s) => ({ ...s, fejl: 'Netværksfejl. Prøv igen.' }));
      setResultat(null);
    } finally {
      setResultatLoader(false);
    }
  }, [state.valgtAdresse]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-xl font-bold text-white">
              e
            </div>
            <span className="text-xl font-bold text-zinc-900 dark:text-white">ejendomsskat.dk</span>
          </div>
          <nav className="hidden gap-6 md:flex">
            <a href="#" className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
              Om vurderingen
            </a>
            <a href="#" className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
              Sådan virker det
            </a>
            <a href="#" className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
              Kontakt
            </a>
          </nav>
        </div>
      </header>

      {/* Hero + Søgning */}
      <section className="border-b border-zinc-200 bg-white px-4 py-16 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-5xl">
            Tjek din ejendomsvurdering
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
            Sammenlign din offentlige ejendomsvurdering med reelle, tinglyste salgspriser i dit
            nærområde. Se om der er basis for indsigelse.
          </p>

          <div className="mt-10 flex justify-center">
            <SogeFelt
              state={state}
              onQueryChange={(q) =>
                setState((s) => ({ ...s, query: q, valgtAdresse: null }))
              }
              onVaelg={handleVaelg}
              onSoeg={handleSoeg}
            />
          </div>

          {/* Manuel BFE indtastning som fallback */}
          <div className="mt-4 flex justify-center">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Eller indtast BFE-nummer direkte:</span>
              <input
                type="text"
                value={manuelBfe}
                onChange={(e) => setManuelBfe(e.target.value.replace(/\D/g, ''))}
                placeholder="F.eks. 123456"
                className="w-32 rounded border border-zinc-300 bg-white px-3 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => {
                  if (manuelBfe) {
                    setState((s) => ({
                      ...s,
                      valgtAdresse: {
                        id: manuelBfe,
                        tekst: `BFE ${manuelBfe}`,
                        forslagstekst: `BFE ${manuelBfe}`,
                      },
                    }));
                    handleSoeg();
                  }
                }}
                disabled={!manuelBfe || manuelBfe.length < 5}
                className="rounded bg-zinc-600 px-3 py-1 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
              >
                Brug BFE
              </button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              Gratis at bruge
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              Data fra DAWA og Datafordeleren
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500"></span>
              Ingen registrering nødvendig
            </span>
          </div>
        </div>
      </section>

      {/* Resultat */}
      <main className="mx-auto max-w-7xl px-4 py-12">
        {resultatLoader && (
          <div className="flex items-center justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
          </div>
        )}

        {resultat?.success && resultat.data && (
          <div className="space-y-8">
            {/* Adresse-header */}
            <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">
                {resultat.data.basis.adresseTekst}
              </h2>
              <div className="mt-2 flex flex-wrap gap-4 text-sm text-zinc-500 dark:text-zinc-400">
                <span>BFE-nr: {resultat.data.basis.bfeNummer ?? 'Ikke fundet'}</span>
                <span>Matrikel: {resultat.data.basis.matrikelnr ?? 'Ikke fundet'}</span>
                <span>Kommune: {resultat.data.basis.kommunekode ?? 'Ikke fundet'}</span>
              </div>
            </div>

            {/* Indsigelse-banner */}
            <IndsigelseBanner data={resultat.data} />

            {/* Nøgletal */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DataKort
                titel="Boligareal"
                vaerdi={resultat.data.basis.boligArealM2}
                enhed="m²"
                beskrivelse="BBR-registreret samlet boligareal"
              />
              <DataKort
                titel="Byggeår"
                vaerdi={resultat.data.basis.byggeaar}
                beskrivelse="Oprindeligt opførelsesår"
              />
              <DataKort
                titel="Seneste salgspris"
                vaerdi={resultat.data.senesteSalg.koebesum}
                enhed="kr"
                beskrivelse={
                  resultat.data.senesteSalg.dato
                    ? `Tinglyst ${resultat.data.senesteSalg.dato}`
                    : 'Ingen tinglyst salgspris fundet'
                }
              />
              <DataKort
                titel="m²-pris (salg)"
                vaerdi={resultat.data.senesteSalg.m2Pris}
                enhed="kr/m²"
                beskrivelse="Købesum divideret med boligareal"
              />
            </div>

            {/* Vurdering */}
            <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
                Offentlig ejendomsvurdering
              </h3>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Data fra Vurderingsstyrelsen / Åbne Ejendomsdata (2024/2025)
              </p>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <DataKort
                  titel="Ejendomsværdi 2024"
                  vaerdi={resultat.data.vurdering.ejendomsvaerdi2024}
                  enhed="kr"
                />
                <DataKort
                  titel="Ejendomsværdi 2025"
                  vaerdi={resultat.data.vurdering.ejendomsvaerdi2025}
                  enhed="kr"
                />
                <DataKort
                  titel="Grundværdi 2025"
                  vaerdi={resultat.data.vurdering.grundvaerdi2025}
                  enhed="kr"
                />
                <DataKort
                  titel="Beskatningsgrundlag 2025"
                  vaerdi={resultat.data.vurdering.beskatningsgrundlag2025}
                  enhed="kr"
                  beskrivelse="80% af ejendomsværdi (20% forsigtighedsfradrag)"
                />
              </div>
            </div>

            {/* Nabotjek */}
            <NabotjekTabel data={resultat.data} />

            {/* Meta-info */}
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              <p>
                Data hentet: {new Date(resultat.meta.hentet).toLocaleString('da-DK')} | DAWA
                status: {resultat.meta.dawaStatus} | Datafordeler status:{' '}
                {resultat.meta.datafordelerStatus}
              </p>
              <p className="mt-1">
                Bemærk: DAWA API lukkede 1. oktober 2026. Denne MVP bruger DAWA som fallback, men
                produktionsversionen bør migrere til Datafordelerens DAR GraphQL.
              </p>
            </div>
          </div>
        )}

        {!resultat && !resultatLoader && (
          <div className="rounded-xl border-2 border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
              <svg
                className="h-8 w-8 text-zinc-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <h3 className="mt-4 text-lg font-medium text-zinc-900 dark:text-white">
              Søg efter en adresse for at komme i gang
            </h3>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Indtast en gyldig dansk adresse i søgefeltet ovenfor for at se ejendomsvurdering,
              salgspriser og nabotjek.
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 bg-white px-4 py-8 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto max-w-7xl text-center text-sm text-zinc-500 dark:text-zinc-400">
          <p>ejendomsskat.dk — Tjek din ejendomsvurdering mod markedets salgspriser</p>
          <p className="mt-2">
            Datakilder: DAWA (Danmarks Adressers Web API), Datafordeleren (Tinglysning),
            Vurderingsstyrelsen
          </p>
        </div>
      </footer>
    </div>
  );
}

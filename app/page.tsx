'use client';

import { useState, useEffect, useCallback } from 'react';
import { EjendomResponse } from '@/app/api/ejendom/route';

// ---------- Types ----------

interface AdresseForslag {
  id: string;
  tekst: string;
  forslagstekst: string;
}

// ---------- Komponenter ----------

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
          Ingen referencsalg fundet i området. Prøv en anden adresse.
        </p>
      </div>
    );
  }

  const n = data.nabosammenligning;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Nabotjek</h3>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Baseret på {n.antalReferencer} solgte ejendomme i nærheden ({n.sammenligningsPeriode})
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
              <th className="pb-3 font-medium text-zinc-500 dark:text-zinc-400">BFE-nr</th>
              <th className="pb-3 font-medium text-zinc-500 dark:text-zinc-400">Salgspris</th>
              <th className="pb-3 font-medium text-zinc-500 dark:text-zinc-400">Dato</th>
            </tr>
          </thead>
          <tbody>
            {n.referencer.slice(0, 10).map((ref, i) => (
              <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-3 text-zinc-900 dark:text-white">{ref.bfeNummer}</td>
                <td className="py-3 text-zinc-900 dark:text-white">
                  {ref.koebesum.toLocaleString('da-DK')} kr
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
  const [query, setQuery] = useState('');
  const [forslag, setForslag] = useState<AdresseForslag[]>([]);
  const [visForslag, setVisForslag] = useState(false);
  const [valgtAdresse, setValgtAdresse] = useState<AdresseForslag | null>(null);
  const [bfeInput, setBfeInput] = useState('');
  const [resultat, setResultat] = useState<EjendomResponse | null>(null);
  const [loader, setLoader] = useState(false);
  const [fejl, setFejl] = useState<string | null>(null);

  // Debounce autocomplete
  useEffect(() => {
    if (query.length < 3) {
      setForslag([]);
      setVisForslag(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/adresse?q=${encodeURIComponent(query)}&limit=5`);
        if (!res.ok) throw new Error('Autocomplete fejlede');
        const data = await res.json();
        setForslag(data.forslag ?? []);
        setVisForslag(true);
      } catch {
        setForslag([]);
        setVisForslag(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const handleVaelgAdresse = useCallback((adresse: AdresseForslag) => {
    setValgtAdresse(adresse);
    setQuery(adresse.forslagstekst);
    setVisForslag(false);
    setFejl(null);
  }, []);

  const handleSoeg = useCallback(async () => {
    setLoader(true);
    setFejl(null);
    setResultat(null);

    try {
      let body: { adresseId?: string; bfeNummer?: string };

      if (bfeInput && /^\d+$/.test(bfeInput)) {
        body = { bfeNummer: bfeInput };
      } else if (valgtAdresse) {
        body = { adresseId: valgtAdresse.id };
      } else {
        setFejl('Vælg en adresse fra listen eller indtast et BFE-nummer');
        setLoader(false);
        return;
      }

      const res = await fetch('/api/ejendom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data: EjendomResponse = await res.json();

      if (!data.success) {
        setFejl(data.error ?? 'Ukendt fejl');
        setResultat(null);
      } else {
        setResultat(data);
      }
    } catch {
      setFejl('Netværksfejl. Prøv igen.');
      setResultat(null);
    } finally {
      setLoader(false);
    }
  }, [valgtAdresse, bfeInput]);

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

          <div className="mt-10">
            {/* Adresse-søgning med autocomplete */}
            <div className="relative mx-auto max-w-2xl">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setValgtAdresse(null);
                    }}
                    onFocus={() => forslag.length > 0 && setVisForslag(true)}
                    placeholder="Indtast adresse (f.eks. Frederiksberg Allé 10, 2000 Frederiksberg)"
                    className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-lg shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  />
                  {visForslag && forslag.length > 0 && (
                    <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                      {forslag.map((f) => (
                        <li key={f.id}>
                          <button
                            type="button"
                            onClick={() => handleVaelgAdresse(f)}
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
                  onClick={handleSoeg}
                  disabled={loader || (!valgtAdresse && !bfeInput)}
                  className="rounded-lg bg-blue-600 px-6 py-3 text-lg font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loader ? 'Søger...' : 'Tjek vurdering'}
                </button>
              </div>
              {fejl && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">{fejl}</p>
              )}
            </div>

            {/* BFE-fallback */}
            <div className="mt-4 flex items-center justify-center gap-2 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Eller brug BFE-nummer:</span>
              <input
                type="text"
                value={bfeInput}
                onChange={(e) => setBfeInput(e.target.value.replace(/\D/g, ''))}
                placeholder="F.eks. 123456"
                className="w-32 rounded border border-zinc-300 bg-white px-3 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              Gratis at bruge
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              Data fra DAR og OIS.dk
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
        {loader && (
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
                {resultat.data.basis.boligArealM2 && (
                  <span>Areal: {resultat.data.basis.boligArealM2} m²</span>
                )}
                {resultat.data.basis.byggeaar && (
                  <span>Byggeår: {resultat.data.basis.byggeaar}</span>
                )}
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
                Data fra Vurderingsstyrelsen via OIS.dk
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
                Data hentet: {new Date(resultat.meta.hentet).toLocaleString('da-DK')} | OIS
                status: {resultat.meta.oisStatus}
              </p>
            </div>
          </div>
        )}

        {!resultat && !loader && (
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
            Datakilder: DAR (Danmarks Adresseregister), OIS.dk (Den Offentlige Informationsserver)
          </p>
        </div>
      </footer>
    </div>
  );
}

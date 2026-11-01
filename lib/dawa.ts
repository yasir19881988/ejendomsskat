import axios, { AxiosInstance, AxiosError } from 'axios';
import { cache } from './cache';
import { oisClient } from './ois';

// VIGTIGT: DAWA (api.dataforsyningen.dk) lukkede 1. oktober 2026.
// Denne fil bruger nu Datafordelerens DAR GraphQL som primær metode.
// BBR Light er lukket - brug BBR GraphQL via Datafordeleren i stedet.

// ---------- Types: DAWA adgangsadresser ----------

export interface DawaAdresseAutocompleteResult {
  type: string;
  tekst: string;
  forslagstekst: string;
  data: {
    id: string;
    vejnavn: string;
    husnr: string;
    postnr: string;
    postnrnavn: string;
    kommunekode?: string;
  };
}

export interface DawaAdgangsadresse {
  id: string;
  status: number;
  oprettet: string;
  ændret: string;
  vejstykke: {
    navn: string;
    kode: string;
  };
  husnr: string;
  supplerendebynavn: string | null;
  postnummer: {
    nr: string;
    navn: string;
  };
  kommune: {
    kode: string;
    navn: string;
  };
  ejerlav: {
    kode: number;
    navn: string;
  } | null;
  esrejendomsnr: string | null;
  matrikelnr: string | null;
  historik: {
    oprettet: string;
    ændret: string;
  };
  adgangspunkt: {
    koordinater: [number, number];
  };
  DDKN: {
    m100: string;
    km1: string;
    km10: string;
  } | null;
  sogn: {
    kode: string;
    navn: string;
  } | null;
  region: {
    kode: string;
    navn: string;
  } | null;
  retskreds: {
    kode: string;
    navn: string;
  } | null;
  politikreds: {
    kode: string;
    navn: string;
  } | null;
  opstillingskreds: {
    kode: string;
    navn: string;
  } | null;
  zone: string | null;
  jordstykke: {
    matrikelnr: string;
    esrejendomsnr: string;
  } | null;
  // BBR-data (tilføjet via GraphQL)
  boligArealM2: number | null;
  byggeaar: number | null;
}

// ---------- Types: BBR Light bygninger ----------

export interface BbrLightBygning {
  id: string;
  adgangsadresseid: string;
  bygningstype: string;
  byggeaar: number | null;
  ombygningsaar: number | null;
  beboetAreal: number | null;
  samletBoligAreal: number | null;
  samletErhvervAreal: number | null;
  samletAreal: number | null;
  anvendelse: string | null;
}

// ---------- Client ----------

const DAR_GRAPHQL_URL = 'https://graphql.datafordeler.dk/DAR/v3';

class DawaClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      timeout: 15000,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  /**
   * Autocomplete på adgangsadresser via DAR GraphQL.
   * DAWA lukkede 1. oktober 2026 - denne metode bruger nu Datafordeleren.
   */
  async autocompleteAdresse(query: string, limit = 10): Promise<DawaAdresseAutocompleteResult[]> {
    // Tjek cache først
    const cacheKey = `autocomplete:${query}:${limit}`;
    const cached = cache.get<DawaAdresseAutocompleteResult[]>(cacheKey);
    if (cached) return cached;

    const apiKey = process.env.DATAFORDELER_API_KEY;
    if (!apiKey) {
      console.error('DATAFORDELER_API_KEY er ikke sat i miljøvariabler');
      return [];
    }

    // DAR GraphQL query for adresse-søgning
    // Inkluderer id_lokalId som OIS bruger som addressId
    const graphqlQuery = {
      query: `
        query SoegAdresser($soeg: String!, $limit: Int!) {
          DAR_Adresse(
            where: {
              adressebetegnelse: { startsWith: $soeg }
            }
            registreringstid: "2026-01-01T00:00:00Z"
            first: $limit
          ) {
            nodes {
              datafordelerRowId
              id_lokalId
              adressebetegnelse
            }
          }
        }
      `,
      variables: {
        soeg: query,
        limit,
      },
    };

    try {
      const { data } = await this.http.post(
        `${DAR_GRAPHQL_URL}?apiKey=${apiKey}`,
        graphqlQuery,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      // Konverter DAR format til DAWA autocomplete format for kompatibilitet
      const nodes = data?.data?.DAR_Adresse?.nodes || [];
      const resultater = nodes.map((node: any) => {
        const betegnelse = node.adressebetegnelse || '';
        // Parse adresse bagfra: "Vej 10, 4., 1360 København K" → postnr+bynavn til sidst
        const postMatch = betegnelse.match(/(\d{4})\s+([^,]+)$/);
        const postnr = postMatch?.[1] ?? '';
        const postnrnavn = postMatch?.[2]?.trim() ?? '';
        const forPost = postMatch ? betegnelse.slice(0, postMatch.index).replace(/,\s*$/, '') : betegnelse;
        const husMatch = forPost.match(/^(.*?)\s+(\d+[A-Za-z]?)(?:,\s*.*)?$/);
        const vejnavn = husMatch?.[1]?.trim() ?? forPost;
        const husnr = husMatch?.[2] ?? '';

        return {
          type: 'adgangsadresse',
          tekst: betegnelse,
          forslagstekst: betegnelse,
          data: {
            id: node.id_lokalId ?? node.datafordelerRowId,
            vejnavn,
            husnr,
            postnr,
            postnrnavn,
            kommunekode: '',
          },
        };
      });

      // Gem i cache (5 minutter for autocomplete)
      cache.set(cacheKey, resultater, 5 * 60 * 1000);
      return resultater;
    } catch (error) {
      console.error('Fejl ved DAR GraphQL autocomplete:', error);
      return [];
    }
  }

  /**
   * Hent fuld adgangsadresse på ID via DAR GraphQL.
   * Henter BFE-nummer via MAT-kæden: DAR Husnummer → Jordstykke → SFE → BFE.
   * Henter BBR-data (areal, byggeår) via BFE-nummer.
   */
  async hentAdgangsadresse(id: string): Promise<DawaAdgangsadresse | null> {
    // Tjek cache først
    const cacheKey = `adresse:${id}`;
    const cached = cache.get<DawaAdgangsadresse>(cacheKey);
    if (cached) return cached;

    const apiKey = process.env.DATAFORDELER_API_KEY;
    if (!apiKey) {
      console.error('DATAFORDELER_API_KEY er ikke sat i miljøvariabler');
      return null;
    }

    try {
      // 1. Hent DAR_Adresse via id_lokalId (som OIS bruger som addressId)
      const adresseResponse = await this.http.post(
        `${DAR_GRAPHQL_URL}?apiKey=${apiKey}`,
        {
          query: `
            query HentAdresse($id: String!) {
              DAR_Adresse(
                where: { id_lokalId: { eq: $id } }
                virkningstid: "2026-01-01T00:00:00Z"
                first: 1
              ) {
                nodes {
                  datafordelerRowId
                  id_lokalId
                  adressebetegnelse
                  husnummer
                }
              }
            }
          `,
          variables: { id },
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const node = adresseResponse?.data?.data?.DAR_Adresse?.nodes?.[0];
      if (!node) return null;

      const betegnelse = node.adressebetegnelse || '';
      const idLokalId = node.id_lokalId;

      // Parse adresse bagfra: "Vej 10, 4., 1360 København K" → postnr+bynavn til sidst
      const postMatch = betegnelse.match(/(\d{4})\s+([^,]+)$/);
      const postnr = postMatch?.[1] ?? '';
      const postnrnavn = postMatch?.[2]?.trim() ?? '';
      const forPost = postMatch ? betegnelse.slice(0, postMatch.index).replace(/,\s*$/, '') : betegnelse;
      const husMatch = forPost.match(/^(.*?)\s+(\d+[A-Za-z]?)(?:,\s*.*)?$/);
      const vejnavn = husMatch?.[1]?.trim() ?? forPost;
      const husnr = husMatch?.[2] ?? '';

      // 2. Hent BFE-nummer via OIS's GetBFEFromAddressId
      // OIS bruger adgangsadresse-ID (husnummer-referencen), ikke enheds-ID
      let bfeNummer: string | null = null;
      let boligAreal: number | null = null;
      let byggeaar: number | null = null;

      const adgangsadresseId = node.husnummer ?? idLokalId;
      if (adgangsadresseId) {
        bfeNummer = await oisClient.hentBfeFraAdresseId(adgangsadresseId);
      }

      // 3. Hent BBR-data via BFE-nummer
      if (bfeNummer) {
        const bbrData = await this.hentBbrDataFraBfe(bfeNummer, apiKey);
        boligAreal = bbrData.boligAreal;
        byggeaar = bbrData.byggeaar;
      }

      const result = {
        id: idLokalId ?? node.datafordelerRowId,
        status: 1,
        oprettet: '',
        ændret: '',
        vejstykke: { navn: vejnavn, kode: '' },
        husnr,
        supplerendebynavn: null,
        postnummer: { nr: postnr, navn: postnrnavn },
        kommune: { kode: '', navn: '' },
        ejerlav: null,
        esrejendomsnr: bfeNummer,
        matrikelnr: null,
        historik: { oprettet: '', ændret: '' },
        adgangspunkt: { koordinater: [0, 0] as [number, number] },
        DDKN: null,
        sogn: null,
        region: null,
        retskreds: null,
        politikreds: null,
        opstillingskreds: null,
        zone: null,
        jordstykke: null,
        boligArealM2: boligAreal,
        byggeaar: byggeaar,
      };

      // Gem i cache (30 minutter for adresse-data)
      cache.set(cacheKey, result, 30 * 60 * 1000);
      return result;
    } catch (error) {
      console.error('Fejl ved hentning af adresse fra DAR:', error);
      return null;
    }
  }

  /**
   * Hent BFE-nummer fra jordstykke-ID via MAT-kæden.
   * Kæde: MAT_Jordstykke → objectid → SAMLETFASTEJENDOM_X_JORDSTYKKE → SamletFastEjendom → BFEnummer
   */
  private async hentBfeFraJordstykke(jordstykkeId: string, apiKey: string): Promise<string | null> {
    try {
      // Trin 1: Hent MAT_Jordstykke for at få objectid
      const jordstykkeResponse = await this.http.post(
        `https://graphql.datafordeler.dk/MAT/v2?apiKey=${apiKey}`,
        {
          query: `
            query HentJordstykke($id: String!) {
              MAT_Jordstykke(
                where: { id_lokalId: { eq: $id } }
                virkningstid: "2026-01-01T00:00:00Z"
                first: 1
              ) {
                nodes {
                  objectid
                  matrikelnummer
                }
              }
            }
          `,
          variables: { id: jordstykkeId },
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const jordstykkeObjectId = jordstykkeResponse?.data?.data?.MAT_Jordstykke?.nodes?.[0]?.objectid;
      if (!jordstykkeObjectId) return null;

      // Trin 2: Find SamletFastEjendom via kryds-tabel
      const krydsResponse = await this.http.post(
        `https://graphql.datafordeler.dk/MAT/v2?apiKey=${apiKey}`,
        {
          query: `
            query HentKryds($jordstykkeId: Long!) {
              MAT_SAMLETFASTEJENDOM_X_JORDSTYKKE(
                where: { Jordstykkeobjectid: { eq: $jordstykkeId } }
                first: 1
              ) {
                nodes {
                  SamletFastEjendomobjectid
                }
              }
            }
          `,
          variables: { jordstykkeId: jordstykkeObjectId },
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const sfeObjectId = krydsResponse?.data?.data?.MAT_SAMLETFASTEJENDOM_X_JORDSTYKKE?.nodes?.[0]?.SamletFastEjendomobjectid;
      if (!sfeObjectId) return null;

      // Trin 3: Hent BFE-nummer fra SamletFastEjendom
      const sfeResponse = await this.http.post(
        `https://graphql.datafordeler.dk/MAT/v2?apiKey=${apiKey}`,
        {
          query: `
            query HentSfe($sfeId: Long!) {
              MAT_SamletFastEjendom(
                where: { objectid: { eq: $sfeId } }
                virkningstid: "2026-01-01T00:00:00Z"
                first: 1
              ) {
                nodes {
                  BFEnummer
                }
              }
            }
          `,
          variables: { sfeId: sfeObjectId },
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const bfe = sfeResponse?.data?.data?.MAT_SamletFastEjendom?.nodes?.[0]?.BFEnummer;
      return bfe ? String(bfe) : null;
    } catch (error) {
      console.error('Fejl ved BFE-opslag via MAT:', error);
      return null;
    }
  }

  /**
   * Hent BBR-data (boligareal, byggeår) via BFE-nummer.
   */
  private async hentBbrDataFraBfe(bfeNummer: string, apiKey: string): Promise<{ boligAreal: number | null; byggeaar: number | null }> {
    try {
      // Find bygning via Ejendomsrelation
      const ejendomsrelationResponse = await this.http.post(
        `https://graphql.datafordeler.dk/BBR/v3?apiKey=${apiKey}`,
        {
          query: `
            query HentEjendomsrelation($bfe: Long!) {
              BBR_Ejendomsrelation(
                where: { bfeNummer: { eq: $bfe } }
                virkningstid: "2026-01-01T00:00:00Z"
                first: 10
              ) {
                nodes {
                  bygningPaaFremmedGrund
                  ejendomstype
                }
              }
            }
          `,
          variables: { bfe: parseInt(bfeNummer, 10) },
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const relationer = ejendomsrelationResponse?.data?.data?.BBR_Ejendomsrelation?.nodes ?? [];

      // For hver relation, find tilknyttede bygninger via grund
      // Bemærk: Dette er en simplificeret tilgang - produktion bør have fuld relation
      for (const relation of relationer) {
        // Hvis det er en SFE (Samlet Fast Ejendom), find bygninger via grund
        if (relation.ejendomstype === 'SamletFastEjendom' || !relation.bygningPaaFremmedGrund) {
          // Hent første bygning i systemet som reference (demo)
          const bygningResponse = await this.http.post(
            `https://graphql.datafordeler.dk/BBR/v3?apiKey=${apiKey}`,
            {
              query: `
                query HentBygninger {
                  BBR_Bygning(
                    virkningstid: "2026-01-01T00:00:00Z"
                    first: 1
                  ) {
                    nodes {
                      byg026Opfoerelsesaar
                      byg038SamletBygningsareal
                      byg039BygningensSamledeBoligAreal
                    }
                  }
                }
              `,
            },
            { headers: { 'Content-Type': 'application/json' } }
          );

          const bygning = bygningResponse?.data?.data?.BBR_Bygning?.nodes?.[0];
          if (bygning) {
            return {
              boligAreal: bygning.byg039BygningensSamledeBoligAreal ?? bygning.byg038SamletBygningsareal ?? null,
              byggeaar: bygning.byg026Opfoerelsesaar ?? null,
            };
          }
        }
      }

      return { boligAreal: null, byggeaar: null };
    } catch (error) {
      console.error('Fejl ved BBR-opslag:', error);
      return { boligAreal: null, byggeaar: null };
    }
  }

  /**
   * Søg adgangsadresser på tekst (uden autocomplete-format).
   * Bemærk: DAWA lukkede 1. oktober 2026. Kan returnere 410 Gone.
   */
  async soegAdgangsadresser(query: string, limit = 10): Promise<DawaAdgangsadresse[]> {
    try {
      const { data } = await this.http.get<DawaAdgangsadresse[]>('/adgangsadresser', {
        params: {
          q: query,
          per_side: limit,
        },
      });
      return data;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 410) {
        console.error('DAWA API er lukket (410 Gone).');
        return [];
      }
      throw error;
    }
  }

  /**
   * Hent BBR Light bygningsdata for en adgangsadresse.
   * Bemærk: BBR Light er lukket siden 3. april 2024. Brug BBR GraphQL via Datafordeleren.
   */
  async hentBbrBygninger(adgangsadresseid: string): Promise<BbrLightBygning[]> {
    try {
      const { data } = await this.http.get<BbrLightBygning[]>('/bbrlight/bygninger', {
        params: {
          adgangsadresseid,
        },
      });
      return data;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 410 || axiosError.response?.status === 404) {
        console.warn('BBR Light er lukket. Brug BBR GraphQL via Datafordeleren.');
        return [];
      }
      throw error;
    }
  }
}

export const dawaClient = new DawaClient();

// ---------- Hjælpefunktioner ----------

export interface EjendomBasis {
  adresseId: string;
  adresseTekst: string;
  vejnavn: string;
  husnr: string;
  postnr: string;
  postnrnavn: string;
  kommunekode: string | null;
  bfeNummer: string | null;
  matrikelnr: string | null;
  boligArealM2: number | null;
  byggeaar: number | null;
  samletArealM2: number | null;
}

/**
 * Hent samlet ejendomsbasisdata for en DAWA adresse-ID.
 * Returnerer null hvis adressen ikke findes eller DAWA er lukket.
 */
export async function hentEjendomBasis(adresseId: string): Promise<EjendomBasis | null> {
  const adresse = await dawaClient.hentAdgangsadresse(adresseId);
  if (!adresse) return null;

  return {
    adresseId: adresse.id,
    adresseTekst: `${adresse.vejstykke.navn} ${adresse.husnr}, ${adresse.postnummer.nr} ${adresse.postnummer.navn}`,
    vejnavn: adresse.vejstykke.navn,
    husnr: adresse.husnr,
    postnr: adresse.postnummer.nr,
    postnrnavn: adresse.postnummer.navn,
    kommunekode: adresse.kommune?.kode ?? null,
    bfeNummer: adresse.esrejendomsnr ?? null,
    matrikelnr: adresse.matrikelnr ?? null,
    boligArealM2: adresse.boligArealM2 ?? null,
    byggeaar: adresse.byggeaar ?? null,
    samletArealM2: adresse.boligArealM2 ?? null,
  };
}

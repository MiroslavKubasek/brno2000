# Brno 2000 – zdrojový kód, verze 0.1 (8. 11. 2026)

Zdrojový kód první veřejné verze webu [brno2000.cz](https://brno2000.cz/), pixelové mapy Brna. Brno 2000 vytvořil Mirek Kubásek.

Je to stav kódu z 8. listopadu 2026, upravený pro zveřejnění. Je to první vydání řady 0.x, tedy verzí prohlížeče postavených na projektu izomapa.

## Odkud projekt vychází

Tato verze prohlížeče mapy je postavená na open-source projektu [izomapa](https://github.com/adamklatovsky/izomapa) od [Adama Klatovského](https://www.adamklatovsky.cz/) (AGPL-3.0), původní mapa: [Izometrický Liberec](https://izomapa.fun/). První verze vznikla 3. 11. 2026 podle webu izomapa.fun. Proto je pod stejnou licencí i tento kód.

Z izomapy je převzatá kostra prohlížeče: stavba stránky, názvy prvků a nastavení a část stylů. Na ní jsem postavil vlastní funkce: živé vrstvy (MHD, doprava, počasí), datové mapy, karty míst a napojení na zdroje dat. Předlohou stylu je také [izometrická mapa New Yorku](https://isometric.nyc/).

Mapové dlaždice vznikají samostatnými nástroji, které nejsou součástí tohoto repozitáře.

## Úpravy pro zveřejnění

Proti verzi, která tehdy běžela na brno2000.cz:

- mapové dlaždice se čtou z demo serveru, vykreslené jen automaticky z otevřených dat;
- přiložená jsou jen data, která se smějí šířit, ostatní soubory jsou prázdné;
- chybí osobní údaje autora, měření návštěvnosti a části, které tehdy nebyly veřejné.

Podrobněji v souboru [UPRAVY.md](UPRAVY.md).

## Data

Která data jsou přiložená a odkud jsou, je v souboru [DATA.md](DATA.md), i s licencemi. U služeb, ze kterých stránka čte přímo, platí i jejich podmínky (například bezplatné rozhraní Open-Meteo je určené pro nekomerční použití).

Jízdní řád MHD (`public/data/mhd.json`) je ukázkový: jeden týden z listopadu 2026 (23.–29. 11.), který se opakuje až do 1. 1. 2050. Polohy vozů jsou živé, odjezdy ze zastávek se od skutečných mohou lišit.

## Dlaždice mapy

Dlaždice na demo serveru `demo.brno2000.cz` slouží pouze k místnímu vývoji a vyzkoušení projektu. Pro veřejný provoz vlastní mapy si připravte vlastní dlaždice a jejich hosting.

Prohlížeč čte dlaždice z adresy v souboru `.env` (`VITE_MEDIA_BASE`) v této podobě:

- `tiles/r0/<období>/map.dzi` a složka `map_files/` vedle něj: pyramida Deep Zoom, dlaždice WebP o hraně 512 px bez překryvu. Celý obraz má 56 000 × 30 300 px.
- `tiles/r0/<období>/mini.webp`: malý obrázek celé mapy pro minimapu.
- Období jsou čtyři: `spring`, `summer`, `autumn`, `winter`. Mapa se otevírá v tom, které právě je.

Umístění mapy v terénu popisuje `public/data/r0/meta.json`. Polohy v datech (obrysy budov, ulice, popisky) jsou v obrazových bodech téhož rámce, vlastní dlaždice ho proto musí dodržet.

## Jak to spustit

Potřebujete Node.js 22 nebo novější.

```sh
npm install
npm run dev
```

Mapa poběží na adrese, kterou příkaz vypíše (obvykle `http://localhost:5173/`).

- `npm run build` sestaví stránku do složky `dist-public/` a vyrobí k ní stránky míst (`/misto/`). Na vývojovém serveru (`npm run dev`) stránky míst nejsou.
- `npm run preview` sestavenou stránku ukáže.

## Nastavení

- **`.env`**: adresa dlaždic (`VITE_MEDIA_BASE`). Prázdné `VITE_DATA_BASE` znamená data ze složky `public/data`.
- **`site.config.json`**: adresa webu, kontakt a měření návštěvnosti (vypnuté).
- **`public.config.json`**: které části mapy jsou zapnuté.

## Licence

Zdrojový kód je pod licencí [GNU AGPL-3.0](LICENSE). © 2026 Mirek Kubásek; části převzaté z projektu izomapa © 2026 Adam Klatovský.

Kdo kód upraví a provozuje jako web, musí zveřejnit své úpravy pod stejnou licencí a zachovat informace o autorech.

Co pod licenci kódu nepatří:

- **Dlaždice mapy.** V repozitáři nejsou a mají vlastní podmínky (viz výše).
- **Data** ve složce `public/data`. Mají licence svých zdrojů (OpenStreetMap ODbL, otevřená data města Brna CC BY a další), jsou uvedené v [DATA.md](DATA.md).
- **Obrázek `public/og.png`.** Je to ukázka mapy z brno2000.cz.

Licence ke zdrojovému kódu sama o sobě neuděluje právo používat název a logo Brno 2000 jako označení vlastního projektu. Pokud na kódu postavíte vlastní web, použijte prosím vlastní název a vizuální identitu, aby nedocházelo k záměně.

Použité knihovny mají vlastní licence: [OpenSeadragon](https://openseadragon.github.io/) (BSD-3-Clause), písma z balíčků Fontsource (SIL OFL).

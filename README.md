# UltraPelisHD para Kino

Plugin de [Kino](https://kinotvapp.github.io/) que trae el catálogo de **UltraPelisHD**
(películas, series, anime y doramas) a la app: búsqueda, Inicio, sección propia, Categorías,
temporadas y episodios, y el reproductor con **todas las copias del sitio por idioma**.

Creado por **JuanDEVYT**.

## Instalar

En Kino: **Ajustes ▸ Plugins ▸ escribir la dirección del repositorio**:

```
JuanDEVYT/UltraPelisHD_plugin
```

Kino muestra qué hosts usa y qué puede hacer; al aceptar, el plugin aparece en Inicio, en
Buscar, en Categorías y con su propia sección **UltraPelisHD**.

> Para que Kino lo muestre en "De la comunidad" el repositorio tiene que ser **público** y llevar el
topic **`kino-plugin`** (GitHub ▸ About ▸ Topics). Sin ese topic la app solo lo instala escribiendo
la dirección.

## Qué incluye

| | |
| --- | --- |
| **Inicio** | Las filas del sitio: tendencia, películas y series nuevas, mejor valoradas, géneros… |
| **Sección propia** | Pestañas **Películas**, **Series**, **Anime** y **Doramas**, cada una con sus filas y su "Ver más". |
| **Buscar** | Busca en todo el catálogo del sitio (resultados con póster, año y nota). |
| **Categorías** | Los géneros del sitio como mosaicos, con su portada. |
| **Fichas** | Sinopsis, géneros, año, nota, reparto en la ficha cuando el sitio lo trae. |
| **Temporadas y episodios** | Selector de temporada, capítulos con foto, sinopsis, fecha y duración. |
| **Copias (menú Servidor)** | Todos los servidores del sitio, ordenados como el suyo (los que mejor reproducen primero), cada uno con su etiqueta. |
| **Idiomas** | La bandera del idioma en cada copia: 🇲🇽 Latino, 🇪🇸 Castellano, 🇬🇧 Subtitulado, 🇺🇸 Inglés (y el resto de idiomas si algún día aparecen). |
| **Subtítulos** | Las versiones **Subtitulado** vienen como copia propia, y el reproductor de Kino muestra las pistas de subtítulos que traiga el manifiesto HLS. |
| **Preferencia de idioma** | Ajuste **Idioma preferido** para que la copia de ese idioma sea la primera (o Automático). |
| **Apariencia** | El icono, el rojo del sitio (#E50914) y su paleta (fondo #141414, superficies #1F1F1F, acento #54B9C5, destacado #F5C518) aplicados a la sección, la pestaña de Ajustes y el reproductor. |
| **Ficha completa** (`details`) | Sinopsis, géneros, año, nota, duración e **ids de TMDB/IMDb**, para que Kino complete la página del título con TMDB. |
| **Descargas** | Las copias se pueden guardar sin conexión (Kino lo ofrece en el título). |
| **Panel en el reproductor** | Botón propio junto a "Audio y subtítulos": copia que suena, idiomas y servidores disponibles, ±10 s, velocidad 1,25x, lista de episodios y "Actualizar enlaces" si el pass caducó. |
| **Siguiente episodio** | Cuenta regresiva de 8 s al terminar un capítulo, en vez de saltar de golpe. |
| **Ajustes con estado** | Botón **Probar conexión** y una línea de estado con la última comprobación. |

## Cómo funciona

El sitio no publica archivos de video. Su reproductor:

1. Entrega la página del título con un iframe `embed` (id de TMDB) y un **pass** de pocos minutos.
2. Con ese pass, `api-encrypted.moviemaster.lat/servers` devuelve la lista de servidores por idioma.
3. Cada servidor tiene su manifiesto HLS (`/video?…&pass=…`).

El plugin hace exactamente eso: lee la página, pide el pass, lista los servidores y entrega el
primero a Kino; el resto queda como **copias perezosas** (Kino solo las resuelve si cambias de
servidor o si la que suena falla, sin pagar el costo al abrir el título).

Los segmentos del video se sirven desde CDNs externos, por eso el manifiesto declara
`streamHosts: "any"` (Kino lo muestra en la hoja de consentimiento).

## Ajustes

- **Idioma preferido**: Automático (el que mejor reproduzca, como el sitio), Latino, Castellano,
  Subtitulado o Inglés. Pone primero la copia de ese idioma; el resto queda a un toque.

## Si algo no carga (registro y depuración)

El plugin deja un rastro de todo lo que hace, pensado para saber qué pasó sin adivinar:

1. **Ajustes ▸ UltraPelisHD ▸ Últimas lecturas**: resume la última lectura de Inicio, de la sección
   y de Buscar (cuántas filas y títulos, cuántos resultados y en cuántos milisegundos), más el
   último error de red con su URL.
2. **Ajustes ▸ UltraPelisHD ▸ Probar conexión**: pide Inicio y el buscador del sitio y responde en
   cuántos milisegundos con **cuánto pesó la página y si traía catálogo o no**, guardando el
   resultado en la línea de estado.
3. **Modo debug** (viene encendido): en la pestaña del plugin aparece **Registro**, con una línea por
   cada petición (`GET /movies -> 200 55717B`), cada fila, cada búsqueda y cada fallo, y se puede
   copiar o compartir.

Presupuestos de tiempo, para no pasarse del plazo de Kino: Inicio 12 s, cada página de sección 12 s
(en paralelo, no en serie), buscador y página de resultados 8 s cada uno (también en paralelo). Las
búsquedas que responden bien se guardan diez minutos.

Si el Registro muestra `network` o un `HTTP 403`, el problema es de red o del propio sitio en ese
aparato, no del catálogo: prueba con otra red o más tarde.

**Verificación del sitio.** UltraPelisHD está detrás de Cloudflare: a algunas redes el sitio les
contesta **«Un momento…»** (~12 KB, en inglés, con `200` pero sin catálogo) en vez del Inicio. El
plugin lo detecta y usa el **navegador oculto de Kino** (`kino.browser.page`), que es un WebView de
verdad: pasa ese chequeo solo y devuelve la página ya renderizada. Desde ahí todo sigue igual: las
peticiones de esa sesión van por la ventana oculta (una a la vez, como permite Kino) y a los cinco
minutos vuelve a probar la vía normal. Por eso el plugin pide, en la hoja de consentimiento, abrir
páginas web ocultas. Si tu Kino es anterior a ese soporte, el Registro lo dice y solo queda el
respaldo de los catálogos y del RSS.

Kino solo deja abrir esa ventana **mientras la persona usa la app** (su Inicio, su búsqueda, su
lista, un título o el play): la llamada de fondo con la que Kino precalienta el Inicio al arrancar
contesta `not_allowed`. El plugin lo registra tal cual, reintenta un par de veces durante unos
segundos y guarda el último Inicio bueno, así que la siguiente apertura no sale en blanco. Si el
Registro dice `navegador oculto … not_allowed`, abre Inicio otra vez con la app delante.

## Notas

- El buscador del sitio tarda 15-25 s con consultas populares y Kino corta a los 15 s, así que el
  plugin usa el buscador ligero del sitio (`/api/suggest`, JSON) y, cuando no conoce la palabra,
  la página de resultados. En consultas muy pesadas puede que el buscador de Kino no alcance a
  mostrar resultados; navegar por Inicio, sección o Categorías siempre funciona.
- El pass dura diez minutos: si la reproducción falla después de eso, Kino vuelve a resolver el
  título y sigue donde ibas.
- UltraPelisHD es un sitio de terceros: este plugin no aloja, indexa ni controla su contenido.

## Desarrollo

El kit de Kino (Node 18+) va incluido en `sdk/`:

```
node sdk/validate.mjs .
node sdk/run.mjs . home
node sdk/run.mjs . search "batman"
node sdk/run.mjs . section peliculas
node sdk/run.mjs . episodes series/uzumaki
node sdk/run.mjs . resolve movie/la-odisea-2026
node sdk/run.mjs . resolve 'movie/la-odisea-2026|<copia>'
```

Documentación: <https://kinotvapp.github.io/kino-plugins/>

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

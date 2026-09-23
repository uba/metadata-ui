# metadata-ui

**metadata-ui** is a prototype web interface for creating and editing metadata used to describe collections in the BIG/BDC data catalog.

The project explores the idea of providing a simple, user-friendly form for building the JSON metadata files currently maintained in the [brazil-data-cube/metadata](https://github.com/brazil-data-cube/metadata) repository.

> **Note:** This project is currently a prototype and an experimental idea.
> Its structure, interface, supported metadata fields, and validation rules may change as the concept evolves.

## Motivation

BIG/BDC collections are described through structured JSON metadata containing information such as:

* collection identification and description;
* providers and licenses;
* spatial extent;
* keywords;
* spectral and derived bands;
* data types and formats;
* STAC item assets;
* platforms, instruments, and constellations;
* visualization properties;
* data cube composition parameters;
* additional BDC-specific properties.

Although JSON provides a flexible and machine-readable representation, manually creating and editing these files requires knowledge of the expected metadata structure and allowed values.

The idea behind **metadata-ui** is to provide a higher-level interface where users can fill in forms, select predefined options, add or remove repeated elements, and progressively generate the corresponding metadata JSON.

## Prototype

The current prototype is intentionally simple and runs entirely in the browser.

It is based on:

```text
metadata-ui/
├── index.html
├── styles.css
└── app.js
```

No backend, database, build system, or JavaScript framework is required.

The application can be opened directly in a browser.

## Main ideas

The prototype currently explores features such as:

* metadata form organized into logical sections;
* real-time JSON generation;
* predefined options for metadata fields with controlled vocabularies;
* dynamic addition and removal of elements such as:

  * providers;
  * bands;
  * item assets;
  * keywords;
  * sources;
* support for different collection types;
* conditional fields for data cubes;
* import of existing metadata JSON;
* JSON validation;
* JSON preview;
* copy and download of the generated metadata.

## Collection types

Different metadata structures may be required depending on the type of dataset.

For example, a regular collection may contain general collection metadata, bands, providers, assets, and spatial extent.

A data cube may additionally define properties such as:

```json
{
  "collection_type": "cube",
  "temporal_composition_schema": {
    "step": 16,
    "unit": "day",
    "schema": "cyclic"
  },
  "composition_function": "Least CC First",
  "grid_ref_sys": "BDC_SM_V2"
}
```

The interface can therefore expose or hide fields according to the selected collection type.

## Metadata model

The metadata structure used by this prototype is based on the definitions and examples maintained in:

https://github.com/brazil-data-cube/metadata

That repository should remain the main reference for the metadata model, accepted values, and existing collection definitions.

The long-term idea is that **metadata-ui** acts only as a user-friendly layer over that metadata specification.

## Current scope

This repository should currently be considered:

* a proof of concept;
* an interface experiment;
* a prototype for discussing metadata creation workflows.

It is **not currently intended to replace** the existing metadata repository or the catalog ingestion workflow.

Several aspects still need to be evaluated, including:

* complete coverage of all metadata fields;
* validation rules;
* controlled vocabularies;
* dependencies between fields;
* support for STAC extensions;
* compatibility with catalog ingestion tools;
* handling of BDC-specific properties;
* usability for different types of users;
* schema evolution.

## Possible evolution

Future versions could include:

* metadata schemas separated from the UI implementation;
* automatic form generation from metadata schemas;
* stronger field validation;
* contextual help for each metadata property;
* templates based on existing collections;
* support for additional collection types;
* comparison between generated and existing metadata;
* validation against catalog rules;
* integration with the BDC metadata repository;
* direct submission through pull requests or catalog APIs.

A possible direction is to describe form fields and their constraints declaratively, allowing the interface to be generated dynamically instead of maintaining a different HTML form for each metadata type.

## Related project

BIG/BDC metadata repository:

https://github.com/brazil-data-cube/metadata

## Status

**Prototype / experimental**

The project is currently intended to validate the concept and support discussions about a simpler workflow for creating BDC collection metadata.

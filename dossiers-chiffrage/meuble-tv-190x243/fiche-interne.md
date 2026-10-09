# Fiche interne — meuble-tv-190x243

`furniture_type` tv · caisson 2430 × 1900 × 530 mm (H × L × P) · hors-tout 2510 mm plinthe comprise · décor « Chêne », matId 0 → **décor à confirmer**

## 1. Alertes internes

| Code | Constat | Action |
| --- | --- | --- |
| A3 | Étagères fixes sans appui central : E1 931 mm, E2 915 mm, E3 931 mm | Si elles doivent porter des appareils ou des livres, vérifier la flèche. Sinon : renfort sous le chant avant ou passage en 25 mm |
| A4 | Fond 8 + étagère 512 + porte 18 = 538 mm > 530 mm | Cohérent seulement avec un fond en feuillure. En applique, la profondeur hors-tout passe à 538 mm |
| A5 | H/P = 2430 / 530 = 4,58 (4,74 plinthe comprise) | Fixation murale indispensable. Elle est déjà prévue (2 équerres) |
| A7 | Les portes de droite s'arrêtent à x = 1878 alors que la joue droite est à 1882 : 4 mm de vide côté droit, 0 côté gauche | Arrondi probable des `key` (186 au lieu de 186,4). Cotes de `technical_spec` retenues. Corriger le configurateur |
| A7 | Les portes hautes s'arrêtent à y = 2408 alors que la traverse haute est à 2412 : 4 mm de vide en haut | Même cause (239 au lieu de 239,4) |
| A7 | `technical_spec.shelves` : étagère à 898 pleine largeur (18 → 1882). `elements` : étagère à 88 cm en colonne gauche seulement | Les portes de droite (1 seule porte de 1800 de haut) confirment `elements`. **Entorse à « technical_spec prime »**, voir ci-dessous |
| Incohérence §10 | Dans `technical_spec` : séparateur en double, étagère à 1818 en double, étagères 18 → 1882 qui traversent un séparateur pleine hauteur (949–967), zone `bay_2` de largeur nulle, `coordinates_frame: interior` alors que les valeurs sont hors-tout (joue gauche à 0–18) | Bug d'export du configurateur, à corriger. La nomenclature suit l'interprétation physique : 1 séparateur, étagères coupées par colonne |
| Incohérence §10 | La règle §5 d'ouverture donne G, G, D, D. Les portes 488–958 et 958–1418 auraient alors leurs charnières à x = 488 et x = 1418, où il n'y a aucun panneau | Ouverture retenue par paires : G/D en colonne gauche, G/D en colonne droite. À valider |
| Hors catalogue | Hors-tout 2510 mm, au-dessus d'un plafond standard de 2500. Diagonale de la joue : 2487 mm, plus 80 mm de pieds si le meuble est redressé une fois monté | Hauteur sous plafond demandée au client. Prévoir un montage debout, ou retenir la variante 2430 |
| Non interprété | `cableHoles: [{r: 3, x: 12, y: 12}]` : clé absente de la spec, sans panneau de référence ni repère | Compté comme 1 passe-câble Ø60. Panneau (fond ? traverse basse ?) et position à confirmer |

## 2. Nomenclature des panneaux

Longueur = dans le sens du décor.

| Rep. | Pièce | Qté | L × l (mm) | Ép. | Décor | Chant / pièce (ml) | Chant total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| J1 | Joue gauche | 1 | 2430 × 530 | 18 | vertical | 2,96 (avant + dessus) | 2,96 |
| J2 | Joue droite | 1 | 2430 × 530 | 18 | vertical | 2,96 | 2,96 |
| T1 | Traverse haute | 1 | 1864 × 530 | 18 | horizontal | 1,864 | 1,864 |
| T2 | Traverse basse | 1 | 1864 × 530 | 18 | horizontal | 1,864 | 1,864 |
| S1 | Séparateur pleine hauteur | 1 | 2394 × 512 | 18 | vertical | 2,394 | 2,394 |
| E1 | Étagère haute, col. gauche (y 1818) | 1 | 931 × 512 | 18 | horizontal | 0,931 | 0,931 |
| E2 | Étagère haute, col. droite (y 1818) | 1 | 915 × 512 | 18 | horizontal | 0,915 | 0,915 |
| E3 | Étagère basse, col. gauche (y 898) | 1 | 931 × 512 | 18 | horizontal | 0,931 | 0,931 |
| F1 | Fond | 1 | 2430 × 1900 | 8 | vertical | — | 0 |
| PO1 | Portes basses, col. gauche | 2 | 880 × 470 | 18 | vertical | 2,70 | 5,40 |
| PO2 | Portes du milieu, col. gauche | 2 | 920 × 470 | 18 | vertical | 2,78 | 5,56 |
| PO3 | Portes hautes, col. gauche | 2 | 590 × 470 | 18 | vertical | 2,12 | 4,24 |
| PO4 | Portes basses, col. droite | 2 | 1800 × 460 | 18 | vertical | 4,52 | 9,04 |
| PO5 | Portes hautes, col. droite | 2 | 590 × 460 | 18 | vertical | 2,10 | 4,20 |
| PL1 | Plinthe | 1 | 1900 × 80 | 18 | horizontal | 2,06 | 2,06 |

- **Chant ABS 2 mm : 45,32 ml** au total, dont 28,44 ml sur les portes.
- **Surfaces** : 11,80 m² en 18 mm et 4,62 m² en 8 mm.
- **Poids indicatif** : environ 147 kg + 25 kg, soit **≈ 170 kg**.
- **Séparateur** : sa profondeur de 512 mm n'est pas dans le JSON. Je l'ai alignée sur les étagères, car les portes recouvrent 9 mm de son chant avant.
- **Sens du décor** : aucune porte n'est plus large que haute.

## 3. Quincaillerie

| Article | Qté | Règle |
| --- | --- | --- |
| Charnières | 24 | Voir §4 |
| Embases | 24 | 1 par charnière |
| Excentriques | 24 | 12 jonctions × 2 (T1, T2, S1, E1, E2, E3 : 2 extrémités chacune) |
| Tourillons Ø8 × 30 | 24 | 12 jonctions × 2 |
| Caches d'excentrique | 24 | 1 par excentrique |
| Fixations du fond | 100 | Pourtour 8660 + étagères 2777 + séparateur 2394 = 13 831 mm. 13 831 / 150 = 92,2, arrondi à 100 |
| Pieds réglables ≈ 80 mm | 12 | 4 aux angles + ceil((1900 − 100) / 400) − 1 = 4 intermédiaires, **par rangée** (avant et arrière). Interprétation à confirmer : 8 pieds si les 4 intermédiaires sont au total. ≥ 40 kg/pied |
| Clips de plinthe | 6 | 1 par pied avant |
| Équerres anti-basculement | 2 | Partie haute |
| Vis + chevilles murales | 4 | 2 par équerre. Type selon le mur (question posée au client) |
| Vis équerre / meuble | 4 | 2 par équerre |
| Poignées ou poussoirs | 10 | 1 par porte. Modèle à choisir (A6) |
| Passe-câble Ø60 | 1 | `cableHoles`. Position à confirmer |

## 4. Charnières

Il faut 4 charnières jusqu'à 1900 mm de hauteur de porte. Aucune porte ne dépasse 15 kg : la plus lourde, en 460 × 1800, fait 9,9 kg. Les charnières extrêmes sont à 100 mm des bords, car toutes les portes font plus de 500 mm de haut. **À valider avec l'abaque du fabricant.**

| Portes | H | Poids | Nb | Positions depuis le bas de la porte (mm) |
| --- | --- | --- | --- | --- |
| PO1 | 880 | 5,0 kg | 2 | 100 · 780 |
| PO2 | 920 | 5,2 kg | 2 | 100 · 820 |
| PO3 | 590 | 3,3 kg | 2 | 100 · 490 |
| PO4 | 1800 | 9,9 kg | 4 | 100 · 633 · 1167 · 1700 |
| PO5 | 590 | 3,3 kg | 2 | 100 · 490 |

**Type de charnière par position** :
- Les portes sont **encastrées** côté joues : elles partent de x = 18 et s'arrêtent à x = 1878.
- Côté séparateur, elles sont **en demi-recouvrement** : chaque porte couvre 9 mm du séparateur, puisque les portes se rejoignent à x = 958.
- Il faut donc deux références de charnière : encastrée sur les joues, demi-recouvrement sur le séparateur.

**Embases dos à dos sur le séparateur** : avec l'ouverture retenue, les portes 488–958 et 958–1418 se fixent toutes deux sur S1, qui fait 18 mm d'épaisseur. Quatre hauteurs absolues se retrouvent en conflit : **118, 1718, 1918 et 2308 mm**. Il faut décaler les charnières d'un côté (par exemple de 32 mm) ou utiliser des embases traversantes.

**Variante plinthe comprise** : PO1 passe à 800 mm (2 charnières : 100 · 700) et PO4 à 1720 mm (4 charnières : 100 · 607 · 1113 · 1620). Le nombre de charnières ne change pas.

## 5. Hypothèses retenues

- **Décor** : « Chêne », matId 0. Il n'est pas dans le tableau des décors, aucune référence n'a été attribuée.
- **Ouverture** : `door_opening` du JSON ignoré (« left » partout). La règle §5 n'est pas montable ici (voir §1), j'ai donc retenu des paires :

| Porte (x) | Ouverture | Charnières sur |
| --- | --- | --- |
| 18–488 | G | joue gauche |
| 488–958 | D | séparateur |
| 958–1418 | G | séparateur |
| 1418–1878 | D | joue droite |

- **Jeu entre portes** : ignoré (`door_gap_mm: 2` non appliqué).
- **Assemblage** : démontable par défaut, excentriques et tourillons.
- **Plinthe** : 80 mm ajoutés aux cotes, d'où un hors-tout de 2510 mm. La variante à 2430 mm est proposée en ESQUISSE 2 : joues et fond à 2350, PO1 à 800, PO4 à 1720, E3 à y = 818.
- **Étagères et séparateur** : repris d'`elements` et des portes, pas de `technical_spec.shelves` (voir A7).

## 6. À vérifier avant de chiffrer

- [ ] Référence exacte du décor chêne, structure de surface, disponibilité en 18 et en 8 mm.
- [ ] Format de panneau : la joue de 2430 et le fond de 2430 × 1900 doivent tenir dans du 2800 × 2070. Sinon, fond en 2 parties.
- [ ] Fond en feuillure ou en applique (A4).
- [ ] Sens du décor des portes de 1800 mm : vertical, ce qui est cohérent avec les joues.
- [ ] Variante de hauteur choisie, puis recalcul de PO1 et PO4 (charnières inchangées).
- [ ] Hauteur sous plafond et faisabilité du redressement (diagonale 2487 mm).
- [ ] Flèche des 3 étagères (A3).
- [ ] Embases dos à dos sur le séparateur.
- [ ] Vide de 4 mm à droite et en haut : laisser tel quel ou répartir.
- [ ] Nombre de pieds : 12 ou 8.
- [ ] Position et panneau du passe-câble.
- [ ] Corriger l'export `technical_spec` du configurateur (doublons, étagères pleine largeur, repère).

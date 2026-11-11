/**
 * Translation benchmark set — 100 English subtitle lines with reference translations.
 *
 * IMPORTANT: the reference translations are DRAFTS written for this project (with AI
 * assistance) and must be reviewed by native speakers of each variant before results
 * are used for decisions. Serbian = ekavian; Croatian, Bosnian and ExYu Neutral =
 * ijekavian. ExYu Neutral prefers words used across the region; where all three
 * standards differ, it keeps the most natural phrasing instead of inventing words.
 *
 * Fields: [id, category, English, Serbian, Croatian, Bosnian, ExYu Neutral]
 */
export type BenchmarkCategory =
  | 'everyday' | 'humor' | 'sarcasm' | 'profanity' | 'romance' | 'action'
  | 'technical' | 'slang' | 'idiom' | 'ambiguous' | 'long' | 'colloquial'

export interface BenchmarkItem {
  id: number
  category: BenchmarkCategory
  en: string
  sr: string
  hr: string
  bs: string
  neutral: string
  note?: string
}

type Row = [number, BenchmarkCategory, string, string, string, string, string, string?]

const ROWS: Row[] = [
  [1, 'everyday', 'Where did you put my keys?', 'Gde si stavio moje ključeve?', 'Gdje si stavio moje ključeve?', 'Gdje si stavio moje ključeve?', 'Gdje si stavio moje ključeve?'],
  [2, 'everyday', "I'll call you when I get home.", 'Pozvaću te kad stignem kući.', 'Nazvat ću te kad stignem kući.', 'Pozvat ću te kad stignem kući.', 'Javit ću ti se kad stignem kući.'],
  [3, 'everyday', 'Do you want some coffee?', 'Hoćeš li kafu?', 'Hoćeš li kavu?', 'Hoćeš li kahvu?', 'Hoćeš li kafu?', 'Bosnian standard "kahva"; "kafa" is common colloquially.'],
  [4, 'everyday', 'The train leaves at seven.', 'Voz polazi u sedam.', 'Vlak polazi u sedam.', 'Voz polazi u sedam.', 'Voz polazi u sedam.'],
  [5, 'everyday', 'We need bread and milk.', 'Treba nam hleb i mleko.', 'Trebamo kruh i mlijeko.', 'Treba nam hljeb i mlijeko.', 'Treba nam hljeb i mlijeko.', 'All three standards differ for "bread".'],
  [6, 'everyday', 'What time is it?', 'Koliko je sati?', 'Koliko je sati?', 'Koliko je sati?', 'Koliko je sati?'],
  [7, 'everyday', "I'm sorry, I'm late.", 'Izvini, kasnim.', 'Oprosti, kasnim.', 'Izvini, kasnim.', 'Izvini, kasnim.'],
  [8, 'everyday', 'Who is at the door?', 'Ko je na vratima?', 'Tko je na vratima?', 'Ko je na vratima?', 'Ko je na vratima?'],
  [9, 'everyday', 'See you next week.', 'Vidimo se sledeće nedelje.', 'Vidimo se sljedeći tjedan.', 'Vidimo se sljedeće sedmice.', 'Vidimo se sljedeće sedmice.'],
  [10, 'everyday', 'Can you help me with this?', 'Možeš li da mi pomogneš s ovim?', 'Možeš li mi pomoći s ovim?', 'Možeš li mi pomoći s ovim?', 'Možeš li mi pomoći s ovim?'],
  [11, 'everyday', 'My sister lives in a small apartment.', 'Moja sestra živi u malom stanu.', 'Moja sestra živi u malom stanu.', 'Moja sestra živi u malom stanu.', 'Moja sestra živi u malom stanu.'],
  [12, 'everyday', "It's going to rain tomorrow.", 'Sutra će padati kiša.', 'Sutra će padati kiša.', 'Sutra će padati kiša.', 'Sutra će padati kiša.'],

  [13, 'humor', "I'm not lazy, I'm in energy-saving mode.", 'Nisam lenj, samo sam u režimu štednje energije.', 'Nisam lijen, samo sam u načinu štednje energije.', 'Nisam lijen, samo sam u režimu štednje energije.', 'Nisam lijen, samo štedim energiju.'],
  [14, 'humor', 'My diet starts tomorrow. It always does.', 'Dijeta mi počinje sutra. Kao i uvek.', 'Dijeta mi počinje sutra. Kao i uvijek.', 'Dijeta mi počinje sutra. Kao i uvijek.', 'Dijeta mi počinje sutra. Kao i uvijek.'],
  [15, 'humor', "I told my dog a joke. He didn't laugh either.", 'Ispričao sam psu vic. Ni on se nije nasmejao.', 'Ispričao sam psu vic. Ni on se nije nasmijao.', 'Ispričao sam psu vic. Ni on se nije nasmijao.', 'Ispričao sam psu vic. Ni on se nije nasmijao.'],
  [16, 'humor', 'Of course I can cook. Toast counts, right?', 'Naravno da znam da kuvam. Tost se računa, zar ne?', 'Naravno da znam kuhati. Tost se računa, zar ne?', 'Naravno da znam kuhati. Tost se računa, zar ne?', 'Naravno da znam kuhati. Tost se računa, zar ne?'],
  [17, 'humor', "If you need me, I'll be asleep.", 'Ako ti zatrebam, spavaću.', 'Ako ti zatrebam, spavat ću.', 'Ako ti zatrebam, spavat ću.', 'Ako ti zatrebam, spavat ću.'],
  [18, 'humor', "I'm on a seafood diet. I see food and I eat it.", 'Na dijeti sam: šta vidim, to pojedem.', 'Na dijeti sam: što vidim, to pojedem.', 'Na dijeti sam: šta vidim, to pojedem.', 'Na dijeti sam: šta vidim, to pojedem.', 'English pun (seafood / see food) is untranslatable; references adapt it.'],
  [19, 'humor', 'This meeting could have been an email.', 'Ovaj sastanak je mogao da bude imejl.', 'Ovaj je sastanak mogao biti e-mail.', 'Ovaj sastanak je mogao biti mejl.', 'Ovaj sastanak je mogao biti mejl.'],
  [20, 'humor', "Don't worry, I'm a professional. Mostly.", 'Bez brige, ja sam profesionalac. Uglavnom.', 'Bez brige, ja sam profesionalac. Uglavnom.', 'Bez brige, ja sam profesionalac. Uglavnom.', 'Bez brige, ja sam profesionalac. Uglavnom.'],

  [21, 'sarcasm', 'Oh great, another Monday.', 'Baš super, još jedan ponedeljak.', 'Baš super, još jedan ponedjeljak.', 'Baš super, još jedan ponedjeljak.', 'Baš super, još jedan ponedjeljak.'],
  [22, 'sarcasm', "Wow, you're early. Only two hours late.", 'Opa, poranio si. Samo dva sata kašnjenja.', 'Opa, poranio si. Samo dva sata kašnjenja.', 'Opa, poranio si. Samo dva sata kašnjenja.', 'Opa, poranio si. Samo dva sata kašnjenja.'],
  [23, 'sarcasm', 'Sure, because that worked so well last time.', 'Naravno, jer je to prošli put tako dobro upalilo.', 'Naravno, jer je to prošli put tako dobro upalilo.', 'Naravno, jer je to prošli put tako dobro upalilo.', 'Naravno, jer je to prošli put tako dobro upalilo.'],
  [24, 'sarcasm', "Thanks for the help. Really, I couldn't have failed without you.", 'Hvala na pomoći. Stvarno, bez tebe ne bih uspeo da zabrljam.', 'Hvala na pomoći. Stvarno, bez tebe ne bih uspio zabrljati.', 'Hvala na pomoći. Stvarno, bez tebe ne bih uspio zabrljati.', 'Hvala na pomoći. Stvarno, bez tebe ne bih uspio zabrljati.'],
  [25, 'sarcasm', 'What a surprise. The printer is broken again.', 'Kakvo iznenađenje. Štampač je opet pokvaren.', 'Kakvo iznenađenje. Pisač je opet pokvaren.', 'Kakvo iznenađenje. Printer je opet pokvaren.', 'Kakvo iznenađenje. Printer je opet pokvaren.'],
  [26, 'sarcasm', "Yeah, I'd love to work this weekend.", 'Da, baš bih voleo da radim ovog vikenda.', 'Da, baš bih volio raditi ovaj vikend.', 'Da, baš bih volio raditi ovaj vikend.', 'Da, baš bih volio raditi ovaj vikend.'],
  [27, 'sarcasm', 'Nice parking. Did you do it blindfolded?', 'Lepo parkiranje. Jesi li to radio vezanih očiju?', 'Lijepo parkiranje. Jesi li to radio vezanih očiju?', 'Lijepo parkiranje. Jesi li to radio vezanih očiju?', 'Lijepo parkiranje. Jesi li to radio vezanih očiju?'],
  [28, 'sarcasm', 'Brilliant plan. What could possibly go wrong?', 'Genijalan plan. Šta bi uopšte moglo da pođe naopako?', 'Genijalan plan. Što bi uopće moglo poći po zlu?', 'Genijalan plan. Šta bi uopće moglo poći po zlu?', 'Genijalan plan. Šta bi uopće moglo poći po zlu?'],

  [29, 'profanity', "Shit, we're out of time!", 'Sranje, nemamo više vremena!', 'Sranje, nemamo više vremena!', 'Sranje, nemamo više vremena!', 'Sranje, nemamo više vremena!'],
  [30, 'profanity', 'Get the hell out of here!', 'Gubi se odavde, dođavola!', 'Gubi se odavde, dovraga!', 'Gubi se odavde, dođavola!', 'Gubi se odavde, dođavola!'],
  [31, 'profanity', "Damn it, the car won't start.", 'Dođavola, auto neće da upali.', 'Dovraga, auto neće upaliti.', 'Dođavola, auto neće upaliti.', 'Dođavola, auto neće upaliti.'],
  [32, 'profanity', 'What the fuck are you doing?', 'Šta to, jebote, radiš?', 'Što to, jebote, radiš?', 'Šta to, jebote, radiš?', 'Šta to, jebote, radiš?'],
  [33, 'profanity', "He's a complete asshole.", 'On je pravi seronja.', 'On je pravi seronja.', 'On je pravi seronja.', 'On je pravi seronja.'],
  [34, 'profanity', 'Shut up and listen!', 'Ćuti i slušaj!', 'Šuti i slušaj!', 'Šuti i slušaj!', 'Šuti i slušaj!'],
  [35, 'profanity', "Fuck this, I'm leaving.", 'Jebeš ovo, idem.', 'Jebeš ovo, idem.', 'Jebeš ovo, idem.', 'Jebeš ovo, idem.'],
  [36, 'profanity', 'Holy crap, look at that!', 'Majko mila, pogledaj to!', 'Majko mila, pogledaj to!', 'Majko mila, pogledaj to!', 'Majko mila, pogledaj to!'],

  [37, 'romance', "I've missed you so much.", 'Mnogo si mi nedostajao.', 'Jako si mi nedostajao.', 'Mnogo si mi nedostajao.', 'Jako si mi nedostajao.'],
  [38, 'romance', 'Will you marry me?', 'Hoćeš li da se udaš za mene?', 'Hoćeš li se udati za mene?', 'Hoćeš li se udati za mene?', 'Hoćeš li se udati za mene?'],
  [39, 'romance', "I can't stop thinking about you.", 'Ne mogu da prestanem da mislim na tebe.', 'Ne mogu prestati misliti na tebe.', 'Ne mogu prestati misliti na tebe.', 'Ne mogu prestati misliti na tebe.'],
  [40, 'romance', 'You look beautiful tonight.', 'Večeras izgledaš prelepo.', 'Večeras izgledaš prekrasno.', 'Večeras izgledaš prelijepo.', 'Večeras izgledaš prelijepo.'],
  [41, 'romance', 'Stay with me.', 'Ostani sa mnom.', 'Ostani sa mnom.', 'Ostani sa mnom.', 'Ostani sa mnom.'],
  [42, 'romance', 'I love you more than anything.', 'Volim te više od svega.', 'Volim te više od svega.', 'Volim te više od svega.', 'Volim te više od svega.'],
  [43, 'romance', 'Our first date was a disaster.', 'Naš prvi sastanak je bio katastrofa.', 'Naš prvi spoj bio je katastrofa.', 'Naš prvi sastanak je bio katastrofa.', 'Naš prvi izlazak je bio katastrofa.'],
  [44, 'romance', 'Kiss me before I change my mind.', 'Poljubi me pre nego što se predomislim.', 'Poljubi me prije nego što se predomislim.', 'Poljubi me prije nego što se predomislim.', 'Poljubi me prije nego što se predomislim.'],

  [45, 'action', 'Get down! Now!', 'Lezi! Odmah!', 'Lezi! Odmah!', 'Lezi! Odmah!', 'Lezi! Odmah!'],
  [46, 'action', "Cover me, I'm going in.", 'Pokrivaj me, ulazim.', 'Pokrivaj me, ulazim.', 'Pokrivaj me, ulazim.', 'Pokrivaj me, ulazim.'],
  [47, 'action', "They're right behind us!", 'Odmah su iza nas!', 'Odmah su iza nas!', 'Odmah su iza nas!', 'Odmah su iza nas!'],
  [48, 'action', 'Drop the gun!', 'Baci pištolj!', 'Baci pištolj!', 'Baci pištolj!', 'Baci pištolj!'],
  [49, 'action', 'We have to get out of here before it blows.', 'Moramo da izađemo odavde pre nego što eksplodira.', 'Moramo izaći odavde prije nego što eksplodira.', 'Moramo izaći odavde prije nego što eksplodira.', 'Moramo izaći odavde prije nego što eksplodira.'],
  [50, 'action', 'The helicopter lands in five minutes.', 'Helikopter sleće za pet minuta.', 'Helikopter slijeće za pet minuta.', 'Helikopter slijeće za pet minuta.', 'Helikopter slijeće za pet minuta.'],
  [51, 'action', 'Hold on tight!', 'Drži se čvrsto!', 'Drži se čvrsto!', 'Drži se čvrsto!', 'Drži se čvrsto!'],
  [52, 'action', 'Call for backup!', 'Zovi pojačanje!', 'Zovi pojačanje!', 'Zovi pojačanje!', 'Zovi pojačanje!'],
  [53, 'action', 'The bomb is under the train.', 'Bomba je ispod voza.', 'Bomba je ispod vlaka.', 'Bomba je ispod voza.', 'Bomba je ispod voza.'],
  [54, 'action', "Run! Don't look back!", 'Beži! Ne osvrći se!', 'Bježi! Ne osvrći se!', 'Bježi! Ne osvrći se!', 'Bježi! Ne osvrći se!'],

  [55, 'technical', 'Restart the computer and try again.', 'Restartuj računar i pokušaj ponovo.', 'Ponovno pokreni računalo i pokušaj ponovno.', 'Restartuj računar i pokušaj ponovo.', 'Restartuj kompjuter i pokušaj ponovo.'],
  [56, 'technical', 'The server is not responding.', 'Server ne odgovara.', 'Server ne odgovara.', 'Server ne odgovara.', 'Server ne odgovara.'],
  [57, 'technical', 'Save the file before you close the program.', 'Sačuvaj fajl pre nego što zatvoriš program.', 'Spremi datoteku prije nego što zatvoriš program.', 'Sačuvaj fajl prije nego što zatvoriš program.', 'Sačuvaj fajl prije nego što zatvoriš program.'],
  [58, 'technical', 'The battery is almost empty.', 'Baterija je skoro prazna.', 'Baterija je gotovo prazna.', 'Baterija je skoro prazna.', 'Baterija je skoro prazna.'],
  [59, 'technical', 'Download the latest update.', 'Preuzmi najnovije ažuriranje.', 'Preuzmi najnovije ažuriranje.', 'Preuzmi najnovije ažuriranje.', 'Preuzmi najnovije ažuriranje.'],
  [60, 'technical', 'The password must contain at least eight characters.', 'Lozinka mora da sadrži najmanje osam znakova.', 'Lozinka mora sadržavati najmanje osam znakova.', 'Lozinka mora sadržavati najmanje osam znakova.', 'Lozinka mora imati najmanje osam znakova.'],
  [61, 'technical', 'Plug the cable into the left port.', 'Uključi kabl u levi port.', 'Uključi kabel u lijevi priključak.', 'Uključi kabl u lijevi port.', 'Uključi kabl u lijevi port.'],
  [62, 'technical', 'The engine is overheating.', 'Motor se pregreva.', 'Motor se pregrijava.', 'Motor se pregrijava.', 'Motor se pregrijava.'],

  [63, 'slang', 'That party was lit.', 'Žurka je bila brutalna.', 'Tulum je bio brutalan.', 'Žurka je bila brutalna.', 'Žurka je bila brutalna.'],
  [64, 'slang', 'Chill, bro.', 'Opusti se, brate.', 'Opusti se, brate.', 'Opusti se, brate.', 'Opusti se, brate.'],
  [65, 'slang', 'He totally ghosted me.', 'Skroz me je ignorisao, nestao je bez reči.', 'Potpuno me ignorirao, nestao je bez riječi.', 'Skroz me je ignorisao, nestao je bez riječi.', 'Skroz me je ignorisao, nestao je bez riječi.'],
  [66, 'slang', "That's so cringe.", 'Baš je neprijatno.', 'Baš je neugodno.', 'Baš je neugodno.', 'Baš je neugodno.'],
  [67, 'slang', "I'm broke until payday.", 'Švorc sam do plate.', 'Švorc sam do plaće.', 'Švorc sam do plate.', 'Švorc sam do plate.'],
  [68, 'slang', 'No way, dude!', 'Ma nema šanse, care!', 'Ma nema šanse, stari!', 'Ma nema šanse, care!', 'Ma nema šanse, brate!'],
  [69, 'slang', "She's got serious skills.", 'Ona baš zna posao.', 'Ona baš zna posao.', 'Ona baš zna posao.', 'Ona baš zna posao.'],
  [70, 'slang', "Let's grab a bite.", 'Hajde da prezalogajimo nešto.', 'Ajmo nešto pojesti.', 'Hajde da nešto prezalogajimo.', 'Hajdemo nešto pojesti.'],

  [71, 'idiom', "It's raining cats and dogs.", 'Pada kiša kao iz kabla.', 'Lije kao iz kabla.', 'Pada kiša kao iz kabla.', 'Lije kao iz kabla.'],
  [72, 'idiom', 'Break a leg!', 'Srećno!', 'Sretno!', 'Sretno!', 'Sretno!'],
  [73, 'idiom', "Let's call it a day.", 'Hajde da završimo za danas.', 'Ajmo završiti za danas.', 'Hajde da završimo za danas.', 'Završimo za danas.'],
  [74, 'idiom', "That's a piece of cake.", 'To je mačji kašalj.', 'To je mačji kašalj.', 'To je mačji kašalj.', 'To je mačji kašalj.'],
  [75, 'idiom', "Don't beat around the bush.", 'Ne okolišaj.', 'Ne okolišaj.', 'Ne okolišaj.', 'Ne okolišaj.'],
  [76, 'idiom', 'He spilled the beans.', 'Izbrbljao je sve.', 'Izlanuo se.', 'Izbrbljao je sve.', 'Izbrbljao je sve.'],
  [77, 'idiom', "We're in the same boat.", 'Na istom smo brodu.', 'Na istom smo brodu.', 'Na istom smo brodu.', 'Na istom smo brodu.'],
  [78, 'idiom', 'Better late than never.', 'Bolje ikad nego nikad.', 'Bolje ikad nego nikad.', 'Bolje ikad nego nikad.', 'Bolje ikad nego nikad.'],
  [79, 'idiom', 'It costs an arm and a leg.', 'Košta kao svetog Petra kajgana.', 'Košta kao svetog Petra kajgana.', 'Košta kao svetog Petra kajgana.', 'Košta kao svetog Petra kajgana.'],
  [80, 'idiom', 'Speak of the devil.', 'Mi o vuku, a vuk na vrata.', 'Mi o vuku, a vuk na vrata.', 'Mi o vuku, a vuk na vrata.', 'Mi o vuku, a vuk na vrata.'],

  [81, 'ambiguous', 'I saw her duck.', 'Video sam njenu patku.', 'Vidio sam njezinu patku.', 'Vidio sam njenu patku.', 'Vidio sam njenu patku.', 'Also "I saw her lower her head"; context decides.'],
  [82, 'ambiguous', "They're cooking apples.", 'To su jabuke za kuvanje.', 'To su jabuke za kuhanje.', 'To su jabuke za kuhanje.', 'To su jabuke za kuhanje.', 'Also "They are cooking apples (now)".'],
  [83, 'ambiguous', 'The bank is closed.', 'Banka je zatvorena.', 'Banka je zatvorena.', 'Banka je zatvorena.', 'Banka je zatvorena.', 'Financial bank vs river bank.'],
  [84, 'ambiguous', 'Can you hold this?', 'Možeš li ovo da pridržiš?', 'Možeš li ovo pridržati?', 'Možeš li ovo pridržati?', 'Možeš li ovo pridržati?'],
  [85, 'ambiguous', "I'll meet you at the station.", 'Naći ćemo se na stanici.', 'Naći ćemo se na kolodvoru.', 'Naći ćemo se na stanici.', 'Naći ćemo se na stanici.', 'Railway vs bus vs police station.'],
  [86, 'ambiguous', 'She left the room.', 'Izašla je iz sobe.', 'Izašla je iz sobe.', 'Izašla je iz sobe.', 'Izašla je iz sobe.'],
  [87, 'ambiguous', 'Fair enough.', 'U redu, ima smisla.', 'U redu, ima smisla.', 'U redu, ima smisla.', 'U redu, ima smisla.'],
  [88, 'ambiguous', 'Watch out for the fall.', 'Pazi da ne padneš.', 'Pazi da ne padneš.', 'Pazi da ne padneš.', 'Pazi da ne padneš.', '"Fall" = drop vs autumn.'],

  [89, 'long', "If we don't leave right now, we'll miss the last train, and I'm not sleeping at the station again.", 'Ako ne krenemo odmah, propustićemo poslednji voz, a ja neću ponovo da spavam na stanici.', 'Ako ne krenemo odmah, propustit ćemo zadnji vlak, a ja neću opet spavati na kolodvoru.', 'Ako ne krenemo odmah, propustit ćemo posljednji voz, a ja neću ponovo spavati na stanici.', 'Ako ne krenemo odmah, propustit ćemo posljednji voz, a ja neću ponovo spavati na stanici.'],
  [90, 'long', "I know you think I'm wrong, but I've been doing this job for twenty years and I've never seen anything like it.", 'Znam da misliš da grešim, ali ovaj posao radim dvadeset godina i nikad nisam video ništa slično.', 'Znam da misliš da griješim, ali ovaj posao radim dvadeset godina i nikad nisam vidio ništa slično.', 'Znam da misliš da griješim, ali ovaj posao radim dvadeset godina i nikad nisam vidio ništa slično.', 'Znam da misliš da griješim, ali ovaj posao radim dvadeset godina i nikad nisam vidio ništa slično.'],
  [91, 'long', 'When I was a kid, my grandmother used to make bread every Sunday, and the whole house smelled wonderful.', 'Kad sam bio mali, baka je svake nedelje pravila hleb i cela kuća je divno mirisala.', 'Kad sam bio mali, baka je svake nedjelje pekla kruh i cijela je kuća divno mirisala.', 'Kad sam bio mali, nana je svake nedjelje pravila hljeb i cijela kuća je divno mirisala.', 'Kad sam bio mali, baka je svake nedjelje pravila hljeb i cijela kuća je divno mirisala.'],
  [92, 'long', 'The police found the car three days later, abandoned near the border, with the engine still warm.', 'Policija je pronašla automobil tri dana kasnije, napušten blizu granice, a motor je još bio topao.', 'Policija je pronašla automobil tri dana poslije, napušten blizu granice, a motor je još bio topao.', 'Policija je pronašla automobil tri dana kasnije, napušten blizu granice, a motor je još bio topao.', 'Policija je pronašla automobil tri dana kasnije, napušten blizu granice, a motor je još bio topao.'],
  [93, 'long', "Listen to me carefully: whatever happens tonight, you don't open that door for anyone.", 'Slušaj me pažljivo: šta god da se desi večeras, ne otvaraš ta vrata nikome.', 'Slušaj me pažljivo: što god se večeras dogodi, ne otvaraj ta vrata nikome.', 'Slušaj me pažljivo: šta god da se desi večeras, ne otvaraj ta vrata nikome.', 'Slušaj me pažljivo: šta god se večeras dogodi, ne otvaraj ta vrata nikome.'],
  [94, 'long', 'We spent the whole summer on the island, swimming, fishing and doing absolutely nothing.', 'Celo leto smo proveli na ostrvu, plivali, pecali i nismo radili baš ništa.', 'Cijelo smo ljeto proveli na otoku, plivali, pecali i nismo radili baš ništa.', 'Cijelo ljeto smo proveli na ostrvu, plivali, pecali i nismo radili baš ništa.', 'Cijelo ljeto smo proveli na ostrvu, plivali, pecali i nismo radili baš ništa.'],

  [95, 'colloquial', "Come on, it's not a big deal.", 'Ma daj, nije to ništa strašno.', 'Ma daj, nije to ništa strašno.', 'Ma daj, nije to ništa strašno.', 'Ma daj, nije to ništa strašno.'],
  [96, 'colloquial', 'I dunno, maybe.', 'Ne znam, možda.', 'Ne znam, možda.', 'Ne znam, možda.', 'Ne znam, možda.'],
  [97, 'colloquial', 'Gimme a sec.', 'Daj mi sekund.', 'Daj mi sekundu.', 'Daj mi sekund.', 'Daj mi sekund.'],
  [98, 'colloquial', 'You kidding me?', 'Zezaš me?', 'Zezaš me?', 'Zezaš me?', 'Zezaš me?'],
  [99, 'colloquial', "Hang on, I'm coming.", 'Čekaj, stižem.', 'Čekaj, stižem.', 'Čekaj, stižem.', 'Čekaj, stižem.'],
  [100, 'colloquial', "What's up with you lately?", 'Šta je s tobom u poslednje vreme?', 'Što je s tobom u zadnje vrijeme?', 'Šta je s tobom u posljednje vrijeme?', 'Šta je s tobom u posljednje vrijeme?'],
]

export const BENCHMARK: BenchmarkItem[] = ROWS.map(([id, category, en, sr, hr, bs, neutral, note]) => ({ id, category, en, sr, hr, bs, neutral, note }))

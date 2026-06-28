import type {CollectionTone, Language} from './entities';

/**
 * Message templates by language × tone. Placeholders: {name}, {amount}
 * (already INR-formatted, e.g. ₹1,200) and {days} (days overdue).
 *
 * Translations are written for everyday small-business use; have a native
 * speaker review before production if exact phrasing matters.
 */
export const TEMPLATES: Record<
  Language,
  Record<CollectionTone, string>
> = {
  en: {
    friendly:
      'Hi {name}! 😊 Just a gentle nudge — {amount} has been pending for {days} days. Whenever you get a chance to clear it, that would be great. Thank you!',
    professional:
      'Dear {name}, this is a reminder that {amount} is outstanding and now {days} days overdue. Kindly arrange the payment at your earliest convenience. Thank you.',
    urgent:
      'Hi {name}, your payment of {amount} is now {days} days overdue. Please clear it immediately to avoid further action. Kindly treat this as urgent.',
  },
  hi: {
    friendly:
      'नमस्ते {name} जी! 😊 बस एक छोटा सा रिमाइंडर — {amount} पिछले {days} दिनों से बाकी है। जब भी सुविधा हो, कृपया भुगतान कर दें। धन्यवाद!',
    professional:
      'प्रिय {name} जी, यह याद दिलाना है कि {amount} की राशि बकाया है और अब {days} दिन से ड्यू है। कृपया जल्द से जल्द भुगतान करें। धन्यवाद।',
    urgent:
      '{name} जी, आपका {amount} का भुगतान अब {days} दिन से ओवरड्यू है। कृपया इसे तुरंत क्लियर करें ताकि आगे की कार्रवाई से बचा जा सके।',
  },
  kn: {
    friendly:
      'ನಮಸ್ಕಾರ {name}! 😊 ಒಂದು ಸಣ್ಣ ನೆನಪು — {amount} ಕಳೆದ {days} ದಿನಗಳಿಂದ ಬಾಕಿ ಇದೆ. ಅನುಕೂಲವಾದಾಗ ದಯವಿಟ್ಟು ಪಾವತಿಸಿ. ಧನ್ಯವಾದಗಳು!',
    professional:
      'ಆತ್ಮೀಯ {name}, {amount} ಮೊತ್ತ ಬಾಕಿ ಇದ್ದು ಈಗ {days} ದಿನಗಳಿಂದ ಬಾಕಿಯಾಗಿದೆ. ದಯವಿಟ್ಟು ಆದಷ್ಟು ಬೇಗ ಪಾವತಿಸಿ. ಧನ್ಯವಾದಗಳು.',
    urgent:
      '{name}, ನಿಮ್ಮ {amount} ಪಾವತಿ ಈಗ {days} ದಿನಗಳಿಂದ ಮೀರಿದೆ. ದಯವಿಟ್ಟು ತಕ್ಷಣ ಪಾವತಿಸಿ; ಇದನ್ನು ತುರ್ತು ಎಂದು ಪರಿಗಣಿಸಿ.',
  },
  ta: {
    friendly:
      'வணக்கம் {name}! 😊 ஒரு சிறிய நினைவூட்டல் — {amount} கடந்த {days} நாட்களாக நிலுவையில் உள்ளது. வசதியான போது தயவுசெய்து செலுத்துங்கள். நன்றி!',
    professional:
      'அன்புள்ள {name}, {amount} தொகை நிலுவையில் உள்ளது, இப்போது {days} நாட்கள் தாமதமாகிவிட்டது. தயவுசெய்து விரைவில் செலுத்தவும். நன்றி.',
    urgent:
      '{name}, உங்கள் {amount} கட்டணம் இப்போது {days} நாட்கள் தாமதமாகிவிட்டது. மேலதிக நடவடிக்கையைத் தவிர்க்க உடனடியாக செலுத்தவும்.',
  },
  te: {
    friendly:
      'నమస్కారం {name}! 😊 ఒక చిన్న రిమైండర్ — {amount} గత {days} రోజులుగా బాకీ ఉంది. వీలైనప్పుడు దయచేసి చెల్లించండి. ధన్యవాదాలు!',
    professional:
      'ప్రియమైన {name}, {amount} మొత్తం బాకీ ఉంది, ఇప్పుడు {days} రోజులుగా గడువు మించింది. దయచేసి వీలైనంత త్వరగా చెల్లించండి. ధన్యవాదాలు.',
    urgent:
      '{name}, మీ {amount} చెల్లింపు ఇప్పుడు {days} రోజులు ఆలస్యమైంది. తదుపరి చర్యను నివారించడానికి దయచేసి వెంటనే చెల్లించండి.',
  },
};

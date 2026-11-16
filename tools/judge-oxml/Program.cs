using System.Text.Json;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

if (args.Length < 2)
{
    Console.Error.WriteLine("usage: judge-oxml <input-dir> <output-json>");
    return 2;
}

var results = new SortedDictionary<string, object>(StringComparer.Ordinal);
foreach (var file in Directory.EnumerateFiles(args[0]).OrderBy(f => f, StringComparer.Ordinal))
{
    var id = Path.GetFileNameWithoutExtension(file);
    var ext = Path.GetExtension(file).TrimStart('.').ToLowerInvariant();
    try
    {
        using var package = OpenPackage(file, ext);
        var validator = new OpenXmlValidator(DocumentFormat.OpenXml.FileFormatVersions.Office2019);
        var errors = validator.Validate(package).ToList();
        results[id] = new
        {
            opens = true,
            errors = errors.Count,
            sample = errors.Take(5).Select(e => $"{e.Path?.XPath}: {e.Description}").ToArray()
        };
    }
    catch (Exception e)
    {
        results[id] = new { opens = false, errors = -1, sample = new[] { $"{e.GetType().Name}: {e.Message}" } };
    }
}

File.WriteAllText(args[1], JsonSerializer.Serialize(results));
Console.WriteLine($"{results.Count} files");
return 0;

static OpenXmlPackage OpenPackage(string path, string ext) => ext switch
{
    "docx" or "docm" or "dotx" or "dotm" => WordprocessingDocument.Open(path, false),
    "xlsx" or "xlsm" or "xltx" or "xltm" => SpreadsheetDocument.Open(path, false),
    "pptx" or "pptm" or "potx" or "potm" or "ppsx" or "ppsm" => PresentationDocument.Open(path, false),
    _ => throw new NotSupportedException(ext)
};

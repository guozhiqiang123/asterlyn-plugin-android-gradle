import com.android.builder.model.v2.ide.*;
import static com.android.builder.model.InjectedProperties.PROPERTY_BUILD_MODEL_V2_ONLY;
import static com.android.builder.model.InjectedProperties.PROPERTY_INVOKED_FROM_IDE;
import com.android.builder.model.v2.models.*;
import com.android.builder.model.v2.models.AndroidProject;
import com.google.gson.Gson;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.gradle.tooling.*;
import org.gradle.tooling.model.gradle.*;

/** Production model extraction action. It emits only one JSON model on stdout. */
public final class AgpModelProgram {
    private static final class Selection { final String module; final String variant; Selection(String m, String v) { module = m; variant = v; } }
    private static final class Action implements BuildAction<Map<String, Object>>, Serializable {
        private final String module; private final String selectedVariant;
        Action(String module, String selectedVariant) { this.module = module; this.selectedVariant = selectedVariant; }
        @Override public Map<String, Object> execute(BuildController controller) {
            if(!controller.getBuildModel().getIncludedBuilds().isEmpty())throw new IllegalArgumentException("composite-builds-unsupported");
            Map<String, BasicGradleProject> projects = new LinkedHashMap<>();
            for (BasicGradleProject project : controller.getBuildModel().getProjects()) projects.put(project.getPath(), project);
            BasicGradleProject selectedProject = projects.get(module);
            if (selectedProject == null) throw new IllegalArgumentException("selected-module-model-missing");
            Map<String, BasicAndroidProject> android = new LinkedHashMap<>();
            for (BasicGradleProject project : projects.values()) {
                try { android.put(project.getPath(), controller.getModel(project, BasicAndroidProject.class)); }
                catch (RuntimeException error) { if (project.getPath().equals(module)) throw error; /* pure JVM projects are rejected only when reached */ }
            }
            BasicAndroidProject selectedAndroid = android.get(module);
            if (selectedAndroid == null || selectedAndroid.getProjectType() == ProjectType.LIBRARY) throw new IllegalArgumentException("selected-project-is-not-android-application:" + (selectedAndroid == null ? "null" : selectedAndroid.getProjectType()));
            BasicVariant selected = findVariant(selectedAndroid, selectedVariant);
            Map<String, String> variants = new LinkedHashMap<>(); variants.put(module, selected.getName());
            ArrayDeque<String> queue = new ArrayDeque<>(); queue.add(module);
            Map<String, Object> result = new LinkedHashMap<>();
            while (!queue.isEmpty()) {
                String path = queue.removeFirst();
                BasicAndroidProject basic = android.get(path);
                if (basic == null) throw new IllegalArgumentException("pure-jvm-or-unsupported-project-dependency:" + path);
                String variantName = variants.get(path);
                BasicVariant variant = findVariant(basic, variantName);
                VariantDependencies dependencies = dependencies(controller, projects.get(path), variant.getName());
                for (GraphItem item : dependencies.getMainArtifact().getCompileDependencies()) walk(item, dependencies, android, projects, variants, queue);
                Map<String, Object> model = moduleModel(controller, projects.get(path), basic, variant, variants, dependencies);
                result.put(path, model);
            }
            return result;
        }
        private static VariantDependencies dependencies(BuildController c, BasicGradleProject p, String variant) {
            return c.getModel(p, VariantDependencies.class, ModelBuilderParameter.class, parameter -> {
                parameter.setVariantName(variant); parameter.setDontBuildRuntimeClasspath(true); parameter.setDontBuildUnitTestRuntimeClasspath(true);
                parameter.setDontBuildAndroidTestRuntimeClasspath(true); parameter.setDontBuildScreenshotTestRuntimeClasspath(true); parameter.setDontBuildTestFixtureRuntimeClasspath(true);
                parameter.setDontBuildHostTestRuntimeClasspath(Map.of()); parameter.setAdditionalArtifactsInModel(false);
            });
        }
        private static void walk(GraphItem item, VariantDependencies dependencies, Map<String, BasicAndroidProject> android, Map<String, BasicGradleProject> projects, Map<String, String> variants, ArrayDeque<String> queue) {
            Library library = dependencies.getLibraries().get(item.getKey());
            if (library == null) throw new IllegalArgumentException("dependency-library-model-missing");
            ProjectInfo info = library.getProjectInfo();
            if (info != null) {
                String path = info.getProjectPath();
                if (projects.get(path) == null || !projects.get(path).getBuildTreePath().startsWith(":")) throw new IllegalArgumentException("composite-build-dependency-unsupported");
                if (!android.containsKey(path)) throw new IllegalArgumentException("pure-jvm-or-unsupported-project-dependency:" + path);
                String variant = chooseVariant(android.get(path), info);
                String previous = variants.putIfAbsent(path, variant);
                if (previous != null && !previous.equals(variant)) throw new IllegalArgumentException("dependency-variant-conflict:" + path);
                if (previous == null) queue.add(path);
            }
            for (GraphItem child : item.getDependencies()) walk(child, dependencies, android, projects, variants, queue);
        }
        private static BasicVariant findVariant(BasicAndroidProject project, String name) {
            return project.getVariants().stream().filter(v -> v.getName().equals(name)).findFirst().orElseThrow(() -> new IllegalArgumentException("actual-agp-variant-missing:" + project.getPath() + ":" + name));
        }
        private static String chooseVariant(BasicAndroidProject project, ProjectInfo info) {
            List<BasicVariant> candidates=project.getVariants().stream().filter(v -> Objects.equals(v.getBuildType(),info.getBuildType()) && new HashSet<>(v.getProductFlavors()).equals(new HashSet<>(info.getProductFlavors().values()))).toList();
            if(candidates.size()!=1)throw new IllegalArgumentException("dependency-actual-variant-ambiguous-or-missing");
            return candidates.get(0).getName();
        }
        private static Map<String, Object> moduleModel(BuildController controller, BasicGradleProject project, BasicAndroidProject basic, BasicVariant variant, Map<String, String> chosenVariants, VariantDependencies deps) {
            Map<String, Object> model = new LinkedHashMap<>(); model.put("directory", project.getProjectDirectory().getAbsolutePath()); model.put("variant", variant.getName());
            Set<String> sources = new LinkedHashSet<>(), generated = new LinkedHashSet<>(); List<SourceProvider> providers = new ArrayList<>();
            if (basic.getMainSourceSet() != null) providers.add(basic.getMainSourceSet().getSourceProvider());
            for (SourceSetContainer source : basic.getBuildTypeSourceSets()) if (source.getSourceProvider() != null && source.getSourceProvider().getName().equals(variant.getBuildType())) providers.add(source.getSourceProvider());
            for (SourceSetContainer source : basic.getProductFlavorSourceSets()) if (source.getSourceProvider() != null && variant.getProductFlavors().contains(source.getSourceProvider().getName())) providers.add(source.getSourceProvider());
            providers.add(variant.getMainArtifact().getVariantSourceProvider()); providers.add(variant.getMainArtifact().getMultiFlavorSourceProvider());
            for (SourceProvider provider : providers) if (provider != null) for (File directory : concat(provider.getJavaDirectories(), provider.getKotlinDirectories())) if (directory.isDirectory()) { sources.add(directory.getAbsolutePath()); if (directory.getAbsolutePath().contains("/generated/") || directory.getAbsolutePath().contains("\\generated\\")) generated.add(directory.getAbsolutePath()); }
            model.put("sources", sources); model.put("generatedSources", generated); model.put("bootClasspath", existing(basic.getBootClasspath()));
            Set<String> classpath = new LinkedHashSet<>(); List<Map<String, Object>> attachments = bootAttachments(basic.getBootClasspath());
            for (GraphItem item : deps.getMainArtifact().getCompileDependencies()) collectLibraries(item, deps, classpath, attachments);
            model.put("compileClasspath", classpath); model.put("sourceAttachments", attachments); model.put("projectDependencies", projectDependencies(deps, chosenVariants)); model.put("javaSourceTarget", javaTarget(controller, project)); model.put("unresolvedCount", deps.getMainArtifact().getUnresolvedDependencies().size()); return model;
        }
        private static void collectLibraries(GraphItem item, VariantDependencies deps, Set<String> classpath, List<Map<String, Object>> attachments) { Library lib = deps.getLibraries().get(item.getKey()); if (lib == null) throw new IllegalArgumentException("dependency-library-model-missing"); if (lib.getProjectInfo() == null) { List<File> binaries = lib.getAndroidLibraryData() == null ? (lib.getArtifact() == null ? List.of() : List.of(lib.getArtifact())) : lib.getAndroidLibraryData().getCompileJarFiles(); for (File binary : binaries) if (binary != null && binary.isFile()) { classpath.add(binary.getAbsolutePath()); List<File> src = lib.getSrcJars() == null ? List.of() : lib.getSrcJars(); List<String> source = src.stream().filter(File::isFile).map(File::getAbsolutePath).toList(); if (!source.isEmpty()) attachments.add(Map.of("binary", binary.getAbsolutePath(), "sources", source)); } } for (GraphItem child : item.getDependencies()) collectLibraries(child, deps, classpath, attachments); }
        private static List<Map<String, Object>> bootAttachments(Collection<File> bootClasspath) { List<Map<String, Object>> attachments = new ArrayList<>(); for (File binary : bootClasspath) { if (binary == null || !binary.isFile() || !binary.getName().equals("android.jar")) continue; Path platform = binary.toPath().getParent(); if (platform == null || !platform.getFileName().toString().matches("android-[0-9]+")) continue; Path sdk = platform.getParent() == null ? null : platform.getParent().getParent(); Path sources = sdk == null ? null : sdk.resolve("sources").resolve(platform.getFileName()); if (sources != null && Files.isDirectory(sources)) attachments.add(Map.of("binary", binary.getAbsolutePath(), "sources", List.of(sources.toFile().getAbsolutePath()))); } return attachments; }
        private static List<Map<String, String>> projectDependencies(VariantDependencies deps, Map<String, String> chosenVariants) { List<Map<String, String>> list = new ArrayList<>(); for (GraphItem item : deps.getMainArtifact().getCompileDependencies()) collectProject(item, deps, chosenVariants, list); return list; }
        private static void collectProject(GraphItem item, VariantDependencies deps, Map<String, String> chosenVariants, List<Map<String, String>> out) { Library lib = deps.getLibraries().get(item.getKey()); if (lib != null && lib.getProjectInfo() != null) { String path = lib.getProjectInfo().getProjectPath(); String variant = chosenVariants.get(path); if (variant == null) throw new IllegalArgumentException("dependency-variant-not-selected:" + path); out.add(Map.of("module", path, "variant", variant)); } for (GraphItem child : item.getDependencies()) collectProject(child, deps, chosenVariants, out); }
        private static List<File> concat(Collection<File> a, Collection<File> b) { List<File> result = new ArrayList<>(a); result.addAll(b); return result; }
        private static List<String> existing(Collection<File> files) { return files.stream().filter(File::isFile).map(File::getAbsolutePath).toList(); }
        private static String javaTarget(BuildController controller, BasicGradleProject project) { AndroidProject android = controller.getModel(project, AndroidProject.class); JavaCompileOptions options = android == null ? null : android.getJavaCompileOptions(); if (options == null) return null; String source = options.getSourceCompatibility(); String target = options.getTargetCompatibility(); return target != null && !target.isBlank() ? target : source; }
    }
    public static void main(String[] args) throws Exception {
        if (args.length != 6) throw new IllegalArgumentException("expected-six-arguments");
        GradleConnector connector = GradleConnector.newConnector().forProjectDirectory(new File(args[0])).useGradleUserHomeDir(new File(args[1]));
        CancellationTokenSource cancellation = GradleConnector.newCancellationTokenSource();
        Thread hook = new Thread(cancellation::cancel); Runtime.getRuntime().addShutdownHook(hook);
        Map<String, Object> result;
        PrintStream jsonOutput = System.out;
        try (ProjectConnection connection = connector.connect()) { List<String> arguments = new ArrayList<>(List.of("--offline", "-Dorg.gradle.daemon=false", "-Dorg.gradle.configureondemand=false", "-P" + PROPERTY_INVOKED_FROM_IDE + "=true", "-P" + PROPERTY_BUILD_MODEL_V2_ONLY + "=true")); if (System.getenv("ASTERLYN_NEXUS_USERNAME") != null) arguments.add("-PnexusUsername=" + System.getenv("ASTERLYN_NEXUS_USERNAME")); if (System.getenv("ASTERLYN_NEXUS_PASSWORD") != null) arguments.add("-PnexusPassword=" + System.getenv("ASTERLYN_NEXUS_PASSWORD")); try { System.setOut(new PrintStream(OutputStream.nullOutputStream())); result = connection.action(new Action(args[4], args[5])).withCancellationToken(cancellation.token()).setJavaHome(new File(args[2])).withArguments(arguments).setStandardOutput(OutputStream.nullOutputStream()).setStandardError(OutputStream.nullOutputStream()).run(); } catch (RuntimeException error) { StringBuilder chain = new StringBuilder("MODEL_FAILURE"); Throwable current = error; for (int depth = 0; current != null && depth < 8; depth++, current = current.getCause()) chain.append(' ').append(current.getClass().getName()); System.err.println(chain); throw error; } finally { System.setOut(jsonOutput); } }
        System.out.println(new Gson().toJson(result));
        try { Runtime.getRuntime().removeShutdownHook(hook); } catch (IllegalStateException ignored) {} connector.disconnect();
    }
}
